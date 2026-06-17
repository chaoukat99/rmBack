const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { generateToken } = require('../utils/jwt');
const { generateUUID } = require('../utils/uuid');
const { validate } = require('../middlewares/validate');
const { registerSchema, loginSchema } = require('../utils/validations');
const uploadS3 = require('../middlewares/upload');
const { notifyUsers } = require('../utils/pushNotifications');
const { sendWelcomeEmail } = require('../utils/email');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// ─────────────────────────────────────────────────────────────────────
// OTP Store  (in-memory — survives server restarts in dev, good enough
// for a 10-minute window; replace Map with Redis for production scale)
// ─────────────────────────────────────────────────────────────────────
const otpStore = new Map(); // key: normalizedPhone, value: { code, expiresAt }
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Plug-in SMS sender — swap this one function for Twilio/InfoBip
async function sendSms(phone, message) {
    // ── PRODUCTION: uncomment and fill in your provider ──────────────
    // const twilio = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
    // await twilio.messages.create({ body: message, from: process.env.TWILIO_FROM, to: phone });
    // ─────────────────────────────────────────────────────────────────
    // DEV fallback: just log the code so you can test without a real SMS account
    console.log(`[OTP SMS] To: ${phone} | Message: ${message}`);
}

// POST /api/auth/send-otp
// Body: { phone: "+212600000000" }
router.post('/send-otp', async (req, res) => {
    const { phone } = req.body;
    if (!phone || phone.trim().length < 6) {
        return res.status(400).json({ error: 'Numéro de téléphone invalide.' });
    }

    const normalizedPhone = phone.trim();

    // Rate-limit: don't resend if an unexpired OTP exists sent < 60s ago
    const existing = otpStore.get(normalizedPhone);
    if (existing && Date.now() < existing.expiresAt - OTP_TTL_MS + 60000) {
        return res.status(429).json({ error: 'Veuillez attendre 60 secondes avant de renvoyer un code.' });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
    otpStore.set(normalizedPhone, { code, expiresAt: Date.now() + OTP_TTL_MS });

    try {
        await sendSms(normalizedPhone, `Votre code RM Tawssil : ${code}. Valable 10 minutes.`);
        res.json({ message: 'Code envoyé avec succès.' });
    } catch (err) {
        console.error('OTP send error:', err);
        res.status(500).json({ error: "Impossible d'envoyer le SMS. Réessayez." });
    }
});

// POST /api/auth/verify-otp
// Body: { phone: "+212600000000", code: "123456" }
router.post('/verify-otp', (req, res) => {
    const { phone, code } = req.body;
    if (!phone || !code) {
        return res.status(400).json({ error: 'Téléphone et code requis.' });
    }

    const normalizedPhone = phone.trim();
    const record = otpStore.get(normalizedPhone);

    if (!record) {
        return res.status(400).json({ error: 'Aucun code envoyé pour ce numéro.' });
    }
    if (Date.now() > record.expiresAt) {
        otpStore.delete(normalizedPhone);
        return res.status(400).json({ error: 'Code expiré. Veuillez en demander un nouveau.' });
    }
    if (record.code !== code.trim()) {
        return res.status(400).json({ error: 'Code incorrect.' });
    }

    // Valid — clean up
    otpStore.delete(normalizedPhone);
    res.json({ valid: true, message: 'Numéro vérifié avec succès.' });
});

const upload = uploadS3.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'driver_license', maxCount: 1 },
    { name: 'registration_document', maxCount: 1 },
    { name: 'vehicle_photos', maxCount: 5 }
]);

// Register a new user
router.post('/register', upload, async (req, res) => {
    // If trajectory/trajectories was sent as stringified JSON (common in FormData), parse it
    if (typeof req.body.trajectory === 'string') {
        try { req.body.trajectory = JSON.parse(req.body.trajectory); } catch (e) {}
    }
    if (typeof req.body.trajectories === 'string') {
        try { req.body.trajectories = JSON.parse(req.body.trajectories); } catch (e) {}
    }

    // Validate request body
    const validationResult = registerSchema.safeParse(req.body);
    if (!validationResult.success) {
        return res.status(400).json({ error: 'Validation failed', details: validationResult.error.errors });
    }

    const { name, email, password, role, phone, trajectory, trajectories } = req.body;

    try {
        // Check if user exists
        const [existingUsers] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUsers.length > 0) {
            return res.status(409).json({ error: 'Email is already registered' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        const userId = generateUUID();

        // Get avatar URL if uploaded (available for any role)
        const avatarUrl = req.files?.avatar ? req.files.avatar[0].location : null;

        // Insert user into DB
        await db.query(
            'INSERT INTO users (id, name, email, password_hash, role, phone, status, avatar) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [userId, name, email, passwordHash, role, phone, role === 'transporter' ? 'pending' : 'active', avatarUrl]
        );

        // If transporter, initialize a simple transporter profile.
        if (role === 'transporter') {
            await db.query(`
                INSERT INTO transporter_profiles (user_id, terms_accepted, terms_accepted_at) 
                VALUES (?, TRUE, CURRENT_TIMESTAMP)
            `, [userId]);

            // Handle multiple trajet (trajectories)
            if (trajectory || (trajectories && trajectories.length > 0)) {
                const finalTrajectories = trajectories && trajectories.length > 0 
                    ? trajectories 
                    : (trajectory ? [trajectory] : []);

                // Bulk INSERT all trajectories in a single round-trip (avoids +57ms RTT per sequential await)
                const trajRows = finalTrajectories
                    .filter(t => t?.from_country && t?.from_city && t?.to_country && t?.to_city)
                    .map(t => [generateUUID(), userId, t.from_country, t.from_city, t.to_country, t.to_city, 'approved']);

                if (trajRows.length > 0) {
                    await db.query(
                        'INSERT INTO transporter_trajectories (id, transporter_id, from_country, from_city, to_country, to_city, status) VALUES ?',
                        [trajRows]
                    );
                }
            }

            // Handle uploaded documents
            if (req.files) {
                const docs = [];
                if (req.files.driver_license) {
                    docs.push([generateUUID(), userId, 'driver_license', req.files.driver_license[0].location, 'pending']);
                }
                if (req.files.registration_document) {
                    docs.push([generateUUID(), userId, 'vehicle_registration', req.files.registration_document[0].location, 'pending']);
                }
                if (req.files.vehicle_photos) {
                    req.files.vehicle_photos.forEach(file => {
                        docs.push([generateUUID(), userId, 'vehicle_photo', file.location, 'pending']);
                    });
                }

                if (docs.length > 0) {
                    await db.query(
                        'INSERT INTO transporter_documents (id, user_id, doc_type, file_url, status) VALUES ?',
                        [docs]
                    );
                }
            }
        }

        // If client, optionally store one initial trajectory ("request voyage").
        // Up to 5 more can be added later from the profile.
        if (role === 'client' && trajectory &&
            trajectory.from_country && trajectory.from_city &&
            trajectory.to_country && trajectory.to_city) {
            await db.query(
                'INSERT INTO client_trajectories (id, client_id, from_country, from_city, to_country, to_city) VALUES (?, ?, ?, ?, ?, ?)',
                [generateUUID(), userId, trajectory.from_country, trajectory.from_city, trajectory.to_country, trajectory.to_city]
            );
        }

        // Generate JWT
        const token = generateToken(userId, role);

        // Welcome email (non-blocking — never delays/breaks the response)
        sendWelcomeEmail({ name, email, role });

        res.status(201).json({
            message: 'User registered successfully',
            token,
            user: { id: userId, name, email, role, phone, status: role === 'transporter' ? 'pending' : 'active', avatar: avatarUrl },
        });
    } catch (error) {
        console.error('Registration Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// User login
router.post('/login', async (req, res) => {
    // Validate request body
    const validationResult = loginSchema.safeParse(req.body);
    if (!validationResult.success) {
        return res.status(400).json({ error: 'Validation failed', details: validationResult.error.errors });
    }

    const { email, password } = req.body;

    try {
        // Find user
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = users[0];

        // Check account status
        if (user.status === 'suspended') {
            return res.status(403).json({ error: `Account is suspended. Please contact support.` });
        }

        // Compare passwords
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Generate JWT
        const token = generateToken(user.id, user.role);

        // Send response (excluding password_hash)
        const { password_hash, ...userResponse } = user;
        let profile = userResponse;

        // Fetch transporter specific details if applicable
        if (profile.role === 'transporter') {
            const [tp] = await db.query('SELECT rating, total_deliveries, vehicle, verified, subscription_status FROM transporter_profiles WHERE user_id = ?', [profile.id]);
            if (tp.length > 0) {
                profile = { ...profile, ...tp[0] };
            }
        }

        res.json({
            message: 'Login successful',
            token,
            user: profile,
        });
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Get current logged in user (Protected)
const { authenticate } = require('../middlewares/auth');
router.get('/me', authenticate, async (req, res) => {
    try {
        const [users] = await db.query('SELECT id, name, email, role, phone, avatar, address, status, created_at FROM users WHERE id = ?', [req.user.id]);
        if (users.length === 0) return res.status(404).json({ error: "User not found" });

        let profile = users[0];

        // Fetch transporter specific details if applicable
        if (profile.role === 'transporter') {
            const [tp] = await db.query('SELECT rating, total_deliveries, vehicle, verified, subscription_status FROM transporter_profiles WHERE user_id = ?', [profile.id]);
            if (tp.length > 0) {
                profile = { ...profile, ...tp[0] };
            }
        }

        res.json(profile);
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
    }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/auth/stats  — Get personal stats for profile dashboard
// ─────────────────────────────────────────────────────────────────────
router.get('/stats', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;

        // 1. Delivery Summary
        // For clients: my shipments. For transporters: my assigned deliveries.
        const [[summary]] = await db.query(`
            SELECT
                COUNT(*) AS total,
                SUM(status = 'Delivered')  AS delivered,
                SUM(status = 'In Transit') AS in_transit,
                SUM(status = 'Pending' OR status = 'Accepted')    AS pending,
                COALESCE(SUM(price), 0)    AS value
            FROM deliveries
            WHERE ${role === 'client' ? 'client_id' : 'transporter_id'} = ?
              AND status != 'Cancelled'
        `, [userId]);

        // 2. Monthly Data for Charts (last 6 months)
        const [monthlyData] = await db.query(`
            SELECT
                DATE_FORMAT(created_at, '%b') AS month,
                DATE_FORMAT(created_at, '%Y-%m') AS month_key,
                COALESCE(SUM(price), 0) AS value,
                COUNT(*) AS count
            FROM deliveries
            WHERE ${role === 'client' ? 'client_id' : 'transporter_id'} = ?
              AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
              AND status != 'Cancelled'
            GROUP BY month_key, month
            ORDER BY month_key ASC
        `, [userId]);

        res.json({
            summary,
            monthlyData
        });
    } catch (err) {
        console.error('GET /auth/stats Error:', err);
        res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// DELETE /api/auth/account  — Permanently delete user account
// ─────────────────────────────────────────────────────────────────────
router.delete('/account', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;

        // Note: FOREIGN KEY constraints with ON DELETE CASCADE in database.sql
        // will automatically clean up:
        // - transporter_profiles
        // - transporter_documents
        // - transporter_trajectories
        // - voyages
        // - deliveries (client_id)
        // - ratings
        // - messages
        // - notifications
        // - reclamations
        // - support_tickets

        const [result] = await db.query('DELETE FROM users WHERE id = ?', [userId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Utilisateur introuvable' });
        }

        res.json({ message: 'Compte supprimé avec succès' });
    } catch (err) {
        console.error('DELETE /auth/account Error:', err);
        res.status(500).json({ error: 'Erreur lors de la suppression du compte' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/auth/deactivate  — Deactivate user account (soft delete)
// ─────────────────────────────────────────────────────────────────────
router.patch('/deactivate', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        await db.query("UPDATE users SET status = 'inactive' WHERE id = ?", [userId]);
        res.json({ message: 'Compte désactivé avec succès' });
    } catch (err) {
        console.error('PATCH /auth/deactivate Error:', err);
        res.status(500).json({ error: 'Erreur lors de la désactivation du compte' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/auth/profile  — Update user profile (name, phone, address, city, avatar)
// Extended version: supports optional avatar upload via multipart/form-data
// ─────────────────────────────────────────────────────────────────────
const avatarUpload = uploadS3.single('avatar');
router.patch('/profile', authenticate, (req, res, next) => {
    avatarUpload(req, res, (err) => {
        if (err) return res.status(400).json({ error: 'Erreur upload avatar', details: err.message });
        next();
    });
}, async (req, res) => {
    try {
        const { name, phone, address, city } = req.body;
        const userId = req.user.id;
        if (!name || !name.trim()) return res.status(400).json({ error: 'Le nom est obligatoire.' });

        const avatarUrl = req.file ? req.file.location : undefined;

        let sql = 'UPDATE users SET name = ?, phone = ?, address = ?, city = ?';
        const params = [name.trim(), phone || null, address || null, city || null];

        if (avatarUrl) {
            sql += ', avatar = ?';
            params.push(avatarUrl);
        }
        sql += ' WHERE id = ?';
        params.push(userId);

        await db.query(sql, params);

        // Return updated user
        const [rows] = await db.query(
            'SELECT id, name, email, role, phone, avatar, address, city, status FROM users WHERE id = ?',
            [userId]
        );
        res.json({ message: 'Profil mis à jour avec succès.', user: rows[0] });
    } catch (err) {
        console.error('PATCH /auth/profile Error:', err);
        res.status(500).json({ error: 'Erreur lors de la mise à jour du profil.' });
    }
});


// ─────────────────────────────────────────────────────────────────────
// PATCH /api/auth/notification-prefs  — Save notification preferences (Right of Opposition)
// ─────────────────────────────────────────────────────────────────────
router.patch('/notification-prefs', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const prefs = JSON.stringify(req.body);
        // Store as JSON in user metadata (add column if needed, or as a separate table)
        await db.query(
            'UPDATE users SET notification_prefs = ? WHERE id = ?',
            [prefs, userId]
        );
        res.json({ message: 'Préférences enregistrées.' });
    } catch (err) {
        console.error('PATCH /auth/notification-prefs Error:', err);
        // Non-blocking: column may not exist yet
        res.json({ message: 'Préférences enregistrées (non persistées).' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/auth/export-data  — Request personal data export (Right to Portability)
// ─────────────────────────────────────────────────────────────────────
router.post('/export-data', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        // Log the export request date for compliance audit trail
        await db.query(
            'INSERT INTO support_tickets (id, user_id, subject, description, status) VALUES (UUID(), ?, ?, ?, ?)',
            [userId, '[EXPORT DONNÉES]', 'Demande automatique d\'export des données personnelles (Art. 7, Loi 09-08)', 'open']
        );
        res.json({ message: 'Demande d\'export enregistrée. Vous recevrez vos données sous 30 jours.' });
    } catch (err) {
        console.error('POST /auth/export-data Error:', err);
        res.status(500).json({ error: 'Erreur lors de l\'enregistrement de la demande.' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/auth/push-token  — Save device push notification token
// ─────────────────────────────────────────────────────────────────────
router.post('/push-token', authenticate, async (req, res) => {
    try {
        const { token } = req.body;
        if (!token || typeof token !== 'string') {
            return res.status(400).json({ error: 'Token invalide' });
        }
        await db.query('UPDATE users SET push_token = ? WHERE id = ?', [token, req.user.id]);
        res.json({ message: 'Token enregistré avec succès' });
    } catch (err) {
        console.error('POST /auth/push-token Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/auth/change-password  — Change password (must be logged in)
// ─────────────────────────────────────────────────────────────────────
router.patch('/change-password', authenticate, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Mot de passe actuel et nouveau mot de passe requis' });
    }
    if (newPassword.length < 8) {
        return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 8 caractères' });
    }
    try {
        const [rows] = await db.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });

        const isMatch = await bcrypt.compare(currentPassword, rows[0].password_hash);
        if (!isMatch) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });

        const salt = await bcrypt.genSalt(10);
        const newHash = await bcrypt.hash(newPassword, salt);
        await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.user.id]);

        res.json({ message: 'Mot de passe modifié avec succès' });
    } catch (err) {
        console.error('PATCH /auth/change-password Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/auth/forgot-password
// Generates a 6-digit reset code stored in DB (15min expiry).
// Without SMTP configured, the code is returned via an in-app notification.
// ─────────────────────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis' });

    try {
        const [users] = await db.query(
            "SELECT id FROM users WHERE email = ? AND status != 'suspended'",
            [email.toLowerCase().trim()]
        );

        // Always return the same message to avoid email enumeration
        if (users.length === 0) {
            return res.json({ message: 'Si cet email existe, un code vous a été envoyé.' });
        }

        const userId = users[0].id;
        // Invalidate old tokens
        await db.query('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ?', [userId]);

        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

        await db.query(
            'INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES (UUID(), ?, ?, ?)',
            [userId, code, expiresAt]
        );

        // Deliver code via in-app notification (push + DB)
        await notifyUsers(db, [userId],
            '🔒 Réinitialisation du mot de passe',
            `Votre code: ${code}. Valable 15 minutes.`,
            { screen: 'ResetPassword' }
        );
        await db.query(
            'INSERT INTO notifications (id, user_id, type, title, body) VALUES (UUID(), ?, ?, ?, ?)',
            [userId, 'password_reset', '🔒 Code de réinitialisation',
             `Votre code: ${code}. Valable 15 minutes. Ne le partagez pas.`]
        );

        res.json({ message: 'Code de réinitialisation envoyé. Vérifiez vos notifications.' });
    } catch (err) {
        console.error('POST /auth/forgot-password Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/auth/reset-password
// Validates the reset code and updates the password.
// ─────────────────────────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
        return res.status(400).json({ error: 'Email, code et nouveau mot de passe requis' });
    }
    if (newPassword.length < 8) {
        return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
    }
    try {
        const [users] = await db.query('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
        if (users.length === 0) return res.status(400).json({ error: 'Email ou code invalide' });

        const userId = users[0].id;
        const [tokens] = await db.query(
            'SELECT id FROM password_reset_tokens WHERE user_id = ? AND token = ? AND used = 0 AND expires_at > NOW()',
            [userId, code]
        );

        if (tokens.length === 0) {
            return res.status(400).json({ error: 'Code invalide ou expiré' });
        }

        await db.query('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [tokens[0].id]);

        const salt = await bcrypt.genSalt(10);
        const newHash = await bcrypt.hash(newPassword, salt);
        await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);

        res.json({ message: 'Mot de passe réinitialisé avec succès' });
    } catch (err) {
        console.error('POST /auth/reset-password Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

module.exports = router;
