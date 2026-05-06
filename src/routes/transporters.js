const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const { updateTransporterProfileSchema, approveTransporterSchema, createTrajectorySchema } = require('../utils/validations');
const uploadS3 = require('../middlewares/upload');

const upload = uploadS3.fields([
    { name: 'driver_license', maxCount: 1 },
    { name: 'registration_document', maxCount: 1 },
    { name: 'vehicle_photos', maxCount: 5 }
]);


// ─────────────────────────────────────────────────────────────────────
// Helper: Create a notification
// ─────────────────────────────────────────────────────────────────────
const { generateUUID } = require('../utils/uuid');

const createNotification = async (userId, type, title, body, deliveryId = null) => {
    try {
        await db.query(
            'INSERT INTO notifications (id, user_id, type, title, body, delivery_id) VALUES (?, ?, ?, ?, ?, ?)',
            [generateUUID(), userId, type, title, body, deliveryId]
        );
    } catch (err) {
        console.error('Notification creation failed:', err);
    }
};

// ─────────────────────────────────────────────────────────────────────
// GET /api/transporters
// List all active+verified transporters (accessible to clients/admins)
// ─────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
    try {
        const params = [];
        let extraFilter = '';

        // Admin sees all (including pending/unverified)
        if (req.user.role !== 'admin') {
            extraFilter = 'AND u.status = "active" AND tp.verified = TRUE';
        } else if (req.query.status) {
            extraFilter = 'AND u.status = ?';
            params.push(req.query.status);
        }

        const [transporters] = await db.query(`
            SELECT u.id, u.name, u.email, u.phone, u.avatar, u.address, u.status,
                   tp.vehicle, tp.vehicle_capacity, tp.license_number,
                   tp.rating, tp.total_deliveries, tp.active_deliveries,
                   tp.earnings, tp.verified, tp.countries, tp.next_trip, tp.bio,
                   tp.subscription_status,
                   (SELECT MIN(price_per_kg) FROM voyages v WHERE v.transporter_id = u.id AND v.status = 'upcoming') as min_price_per_kg
            FROM   users u
            JOIN   transporter_profiles tp ON tp.user_id = u.id
            WHERE  u.role = 'transporter'
            ${extraFilter}
            ORDER BY tp.rating DESC, tp.total_deliveries DESC
        `, params);

        res.json(transporters);
    } catch (err) {
        console.error('GET /transporters Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/transporters/pending
// List pending (unverified) transporter registrations — admin only
// ─────────────────────────────────────────────────────────────────────
router.get('/pending', authenticate, authorizeRoles('admin'), async (req, res) => {
    try {
        const [transporters] = await db.query(`
            SELECT u.id, u.name, u.email, u.phone, u.avatar, u.status, u.created_at,
                   tp.vehicle, tp.vehicle_capacity, tp.license_number,
                   tp.rating, tp.total_deliveries, tp.verified, tp.countries,
                   tp.subscription_status
            FROM   users u
            JOIN   transporter_profiles tp ON tp.user_id = u.id
            WHERE  u.role = 'transporter' AND (u.status = 'pending' OR tp.verified = FALSE OR tp.subscription_status = 'pending')
            ORDER BY u.created_at DESC
        `);
        res.json(transporters);
    } catch (err) {
        console.error('GET /transporters/pending Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/transporters/:id  — Public transporter profile
// ─────────────────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT u.id, u.name, u.email, u.phone, u.avatar, u.address, u.status, u.created_at,
                   tp.vehicle, tp.vehicle_capacity, tp.license_number,
                   tp.rating, tp.total_deliveries, tp.active_deliveries,
                   tp.earnings, tp.verified, tp.countries, tp.next_trip, tp.bio,
                   tp.subscription_status,
                   (SELECT MIN(price_per_kg) FROM voyages v WHERE v.transporter_id = u.id AND v.status = 'upcoming') as min_price_per_kg
            FROM   users u
            JOIN   transporter_profiles tp ON tp.user_id = u.id
            WHERE  u.id = ? AND u.role = 'transporter'
        `, [req.params.id]);

        if (rows.length === 0) return res.status(404).json({ error: 'Transporteur introuvable' });

        // Hide earnings from non-admin non-self viewers
        const t = rows[0];
        if (req.user.role === 'client') {
            delete t.earnings;
        }

        res.json(t);
    } catch (err) {
        console.error('GET /transporters/:id Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/transporters/:id/stats  — Transporter stats (self or admin)
// ─────────────────────────────────────────────────────────────────────
router.get('/:id/stats', authenticate, async (req, res) => {
    // Only the transporter themselves or admin can view full stats
    if (req.user.role === 'client') {
        return res.status(403).json({ error: 'Accès refusé' });
    }
    if (req.user.role === 'transporter' && req.user.id !== req.params.id) {
        return res.status(403).json({ error: 'Accès refusé' });
    }

    try {
        const [tp] = await db.query(`
            SELECT tp.rating, tp.total_deliveries, tp.active_deliveries,
                   tp.earnings, tp.verified, tp.countries, tp.subscription_status
            FROM   transporter_profiles tp
            WHERE  tp.user_id = ?
        `, [req.params.id]);

        if (tp.length === 0) return res.status(404).json({ error: 'Profil transporteur introuvable' });

        // Count unique conversations (deliveries where they sent messages OR are assigned)
        const [convRow] = await db.query(`
            SELECT COUNT(DISTINCT d_id) as conversation_count FROM (
                SELECT delivery_id as d_id FROM messages WHERE sender_id = ?
                UNION
                SELECT id as d_id FROM deliveries WHERE transporter_id = ?
            ) as conversations
        `, [req.params.id, req.params.id]);

        const [citiesRow] = await db.query(
            "SELECT COUNT(DISTINCT to_city) as cities_count FROM voyages WHERE transporter_id = ?",
            [req.params.id]
        );

        const [nextTrip] = await db.query(
            "SELECT from_city, to_city, departure_date FROM voyages WHERE transporter_id = ? AND status = 'upcoming' AND departure_date >= CURDATE() ORDER BY departure_date ASC LIMIT 1",
            [req.params.id]
        );

        res.json({
            ...tp[0],
            totalEarnings: tp[0].earnings,
            deliveriesCompleted: tp[0].total_deliveries,
            activeDeliveries: tp[0].active_deliveries,
            conversationCount: convRow?.[0]?.conversation_count || 0,
            cities_visited: citiesRow?.[0]?.cities_count || 0,
            next_trip_details: nextTrip?.[0] || null,
        });
    } catch (err) {
        console.error(`[STATS ERROR] ID: ${req.params.id}`, err);
        res.status(500).json({ error: 'Erreur interne du serveur', details: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────
// PUT /api/transporters/profile  — Update own transporter profile
// ─────────────────────────────────────────────────────────────────────
router.put('/profile', authenticate, authorizeRoles('transporter'), async (req, res) => {
    const result = updateTransporterProfileSchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ error: 'Validation échouée', details: result.error.errors });
    }

    const { vehicle, vehicle_capacity, license_number, countries, bio } = result.data;

    try {
        await db.query(`
            UPDATE transporter_profiles
            SET    vehicle = COALESCE(?, vehicle),
                   vehicle_capacity = COALESCE(?, vehicle_capacity),
                   license_number = COALESCE(?, license_number),
                   countries = COALESCE(?, countries),
                   bio = COALESCE(?, bio)
            WHERE  user_id = ?
        `, [
            vehicle || null,
            vehicle_capacity || null,
            license_number || null,
            countries ? JSON.stringify(countries) : null,
            bio || null,
            req.user.id
        ]);

        res.json({ message: 'Profil mis à jour avec succès' });
    } catch (err) {
        console.error('PUT /transporters/profile Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/transporters/:id/approve  — Admin: approve or reject a transporter
// ─────────────────────────────────────────────────────────────────────
router.patch('/:id/approve', authenticate, authorizeRoles('admin'), async (req, res) => {
    const result = approveTransporterSchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ error: 'Décision invalide', details: result.error.errors });
    }

    const { decision, admin_note } = result.data;

    try {
        // Verify transporter exists
        const [users] = await db.query("SELECT id, name FROM users WHERE id = ? AND role = 'transporter'", [req.params.id]);
        if (users.length === 0) return res.status(404).json({ error: 'Transporteur introuvable' });

        const transporter = users[0];

        if (decision === 'approved') {
            // Activate user account and verify profile
            await db.query("UPDATE users SET status = 'active' WHERE id = ?", [req.params.id]);
            await db.query('UPDATE transporter_profiles SET verified = TRUE WHERE user_id = ?', [req.params.id]);

            await createNotification(
                req.params.id,
                'account_approved',
                '✅ Compte approuvé!',
                'Votre compte transporteur a été vérifié et approuvé. Vous pouvez maintenant accepter des livraisons.'
            );
        } else {
            // Suspend account
            await db.query("UPDATE users SET status = 'suspended' WHERE id = ?", [req.params.id]);

            await createNotification(
                req.params.id,
                'account_rejected',
                '❌ Compte refusé',
                admin_note || 'Votre dossier n\'a pas été approuvé. Contactez le support pour plus d\'informations.'
            );
        }

        res.json({
            message: `Transporteur ${decision === 'approved' ? 'approuvé' : 'refusé'} avec succès`,
            transporter_id: req.params.id,
            decision,
        });
    } catch (err) {
        console.error('PATCH /transporters/:id/approve Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/transporters/subscription/request
// Transporter: request a subscription
// ─────────────────────────────────────────────────────────────────────
router.post('/subscription/request', authenticate, authorizeRoles('transporter'), async (req, res) => {
    try {
        const [profiles] = await db.query('SELECT subscription_status FROM transporter_profiles WHERE user_id = ?', [req.user.id]);
        if (profiles.length === 0) return res.status(404).json({ error: 'Profil introuvable' });

        if (profiles[0].subscription_status === 'active') {
            return res.status(400).json({ error: 'Vous avez déjà un abonnement actif' });
        }
        if (profiles[0].subscription_status === 'pending') {
            return res.status(400).json({ error: 'Votre demande d\'abonnement est déjà en cours d\'examen' });
        }

        await db.query('UPDATE transporter_profiles SET subscription_status = "pending" WHERE user_id = ?', [req.user.id]);
        
        // Notify admin (logically)
        res.json({ message: 'Demande d\'abonnement envoyée avec succès' });
    } catch (err) {
        console.error('POST /subscription/request Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/transporters/:id/subscription/approve
// Admin: approve or reject a subscription request
// ─────────────────────────────────────────────────────────────────────
router.patch('/:id/subscription/approve', authenticate, authorizeRoles('admin'), async (req, res) => {
    const result = approveTransporterSchema.safeParse(req.body); // Use same schema for decision
    if (!result.success) {
        return res.status(400).json({ error: 'Décision invalide', details: result.error.errors });
    }

    const { decision, admin_note } = result.data;

    try {
        const [profiles] = await db.query('SELECT subscription_status FROM transporter_profiles WHERE user_id = ?', [req.params.id]);
        if (profiles.length === 0) return res.status(404).json({ error: 'Profil transporteur introuvable' });

        if (decision === 'approved') {
            await db.query('UPDATE transporter_profiles SET subscription_status = "active" WHERE user_id = ?', [req.params.id]);
            await createNotification(
                req.params.id,
                'subscription_approved',
                '💎 Abonnement Approuvé!',
                'Félicitations! Votre abonnement a été approuvé. Vous pouvez maintenant communiquer sans limites avec les clients.'
            );
        } else {
            await db.query('UPDATE transporter_profiles SET subscription_status = "none" WHERE user_id = ?', [req.params.id]);
            await createNotification(
                req.params.id,
                'subscription_rejected',
                '⚠️ Abonnement Refusé',
                admin_note || 'Votre demande d\'abonnement n\'a pas été approuvée. Contactez le support pour plus d\'informations.'
            );
        }

        res.json({ message: `Abonnement ${decision === 'approved' ? 'approuvé' : 'refusé'} avec succès` });
    } catch (err) {
        console.error('PATCH /subscription/approve Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/transporters/:id/trajectories
// Transporter/Admin: list trajectories of a transporter
// ─────────────────────────────────────────────────────────────────────
router.get('/:id/trajectories', authenticate, async (req, res) => {
    if (req.user.role !== 'admin' && String(req.user.id) !== String(req.params.id)) {
        return res.status(403).json({ error: `Accès refusé: Votre ID (${req.user.id}) ne correspond pas au profil demandé (${req.params.id})` });
    }
    try {
        const [trajectories] = await db.query('SELECT * FROM transporter_trajectories WHERE transporter_id = ? ORDER BY created_at DESC', [req.params.id]);
        res.json(trajectories);
    } catch (err) {
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/transporters/trajectories
// Transporter: request a new trajectory
// ─────────────────────────────────────────────────────────────────────
router.post('/trajectories', authenticate, authorizeRoles('transporter'), async (req, res) => {
    const result = createTrajectorySchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ error: 'Validation échouée', details: result.error.errors });
    }
    const { from_country, from_city, to_country, to_city } = result.data;
    try {
        const trajId = generateUUID();
        await db.query(`
            INSERT INTO transporter_trajectories (id, transporter_id, from_country, from_city, to_country, to_city, status)
            VALUES (?, ?, ?, ?, ?, ?, 'pending')
        `, [trajId, req.user.id, from_country, from_city, to_country, to_city]);

        res.status(201).json({ message: 'Demande de trajet envoyée', id: trajId });
    } catch (err) {
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/transporters/trajectories/:id/approve
// Admin: approve or reject a trajectory
// ─────────────────────────────────────────────────────────────────────
router.patch('/trajectories/:id/approve', authenticate, authorizeRoles('admin'), async (req, res) => {
    const { decision } = req.body;
    if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Décision invalide' });
    
    try {
        const [rows] = await db.query('SELECT transporter_id FROM transporter_trajectories WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Trajet introuvable' });

        await db.query('UPDATE transporter_trajectories SET status = ? WHERE id = ?', [decision, req.params.id]);
        
        await createNotification(
            rows[0].transporter_id,
            'trajectory_' + decision,
            decision === 'approved' ? '✅ Trajet Approuvé!' : '❌ Trajet Refusé',
            'Votre demande de trajet a été ' + (decision === 'approved' ? 'approuvée' : 'refusée') + '.'
        );

        res.json({ message: 'Trajet mis à jour avec succès' });
    } catch (err) {
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/transporters/documents  — Upload transporter documents
// ─────────────────────────────────────────────────────────────────────
router.post('/documents', authenticate, authorizeRoles('transporter'), upload, async (req, res) => {
    try {
        const userId = req.user.id;
        const docs = [];

        if (req.files) {
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
                // Delete old pending documents of the same type? 
                // For now, just add new ones.
                await db.query(
                    'INSERT INTO transporter_documents (id, user_id, doc_type, file_url, status) VALUES ?',
                    [docs]
                );
            }
        }

        res.json({ message: 'Documents téléchargés avec succès et en attente de vérification' });
    } catch (err) {
        console.error('POST /transporters/documents Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/transporters/me/documents — Get my documents status
// ─────────────────────────────────────────────────────────────────────
router.get('/me/documents', authenticate, authorizeRoles('transporter', 'admin'), async (req, res) => {
    try {
        const userId = req.user.role === 'admin' ? (req.query.userId || req.user.id) : req.user.id;
        const [docs] = await db.query('SELECT * FROM transporter_documents WHERE user_id = ? ORDER BY created_at DESC', [userId]);
        res.json(docs);
    } catch (err) {
        console.error('GET /transporters/me/documents Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

module.exports = router;
