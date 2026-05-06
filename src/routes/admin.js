const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const { updateUserStatusSchema, createSupportSchema } = require('../utils/validations');
const bcrypt = require('bcryptjs');
const { generateUUID } = require('../utils/uuid');

// ─────────────────────────────────────────────────────────────────────
// GET /api/admin/stats
// Platform-wide statistics for the admin dashboard
// ─────────────────────────────────────────────────────────────────────
router.get('/stats', authenticate, authorizeRoles('admin'), async (req, res) => {
    try {
        const [[userStats]] = await db.query(`
            SELECT
                COUNT(*) AS total_users,
                SUM(role = 'client')      AS total_clients,
                SUM(role = 'transporter') AS total_transporters,
                SUM(role = 'admin')       AS total_admins,
                SUM(status = 'pending')   AS pending_users
            FROM users
        `);

        const [[deliveryStats]] = await db.query(`
            SELECT
                COUNT(*)                         AS total_deliveries,
                SUM(status = 'Pending')          AS pending_deliveries,
                SUM(status = 'In Transit')       AS in_transit_deliveries,
                SUM(status = 'Delivered')        AS delivered_deliveries,
                SUM(status = 'Cancelled')        AS cancelled_deliveries,
                SUM(price)                       AS total_revenue,
                AVG(price)                       AS avg_delivery_price,
                SUM(is_urgent)                   AS urgent_deliveries,
                SUM(is_insured)                  AS insured_deliveries
            FROM deliveries
        `);

        const [[transporterStats]] = await db.query(`
            SELECT
                COUNT(*)            AS total_transporters,
                SUM(verified = 1)   AS verified_transporters,
                SUM(verified = 0)   AS pending_transporters,
                AVG(rating)         AS avg_rating
            FROM transporter_profiles
        `);

        const [[routeStats]] = await db.query(`
            SELECT COUNT(*) AS active_routes FROM shipping_routes WHERE is_active = TRUE
        `);

        const [[reclamationStats]] = await db.query(`
            SELECT
                COUNT(*)                   AS total_reclamations,
                SUM(status = 'open')       AS open_reclamations,
                SUM(status = 'resolved')   AS resolved_reclamations
            FROM reclamations
        `);

        res.json({
            users: userStats,
            deliveries: deliveryStats,
            transporters: transporterStats,
            routes: routeStats,
            reclamations: reclamationStats,
        });
    } catch (err) {
        console.error('GET /admin/stats Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/admin/revenue
// Monthly revenue data for the bar chart on admin dashboard
// ─────────────────────────────────────────────────────────────────────
router.get('/revenue', authenticate, authorizeRoles('admin'), async (req, res) => {
    try {
        const months = parseInt(req.query.months) || 6;
        const [rows] = await db.query(`
            SELECT
                DATE_FORMAT(created_at, '%b') AS month,
                DATE_FORMAT(created_at, '%Y-%m') AS month_key,
                COALESCE(SUM(price), 0) AS revenue,
                COUNT(*) AS deliveries
            FROM deliveries
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? MONTH)
              AND status != 'Cancelled'
            GROUP BY month_key, month
            ORDER BY month_key ASC
        `, [months]);

        res.json(rows);
    } catch (err) {
        console.error('GET /admin/revenue Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/admin/users
// List all users with optional filtering
// ─────────────────────────────────────────────────────────────────────
router.get('/users', authenticate, authorizeRoles('admin'), async (req, res) => {
    try {
        const { role, status, search } = req.query;
        const params = [];
        const conditions = [];

        if (role)   { conditions.push('u.role = ?');   params.push(role); }
        if (status) { conditions.push('u.status = ?'); params.push(status); }
        if (search) {
            conditions.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)');
            const s = `%${search}%`;
            params.push(s, s, s);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const [users] = await db.query(`
            SELECT u.id, u.name, u.email, u.role, u.phone, u.avatar,
                   u.status, u.created_at,
                   tp.rating, tp.total_deliveries, tp.verified, tp.subscription_status, tp.messaging_disabled
            FROM   users u
            LEFT   JOIN transporter_profiles tp ON tp.user_id = u.id AND u.role = 'transporter'
            ${whereClause}
            ORDER BY u.created_at DESC
            LIMIT 100
        `, params);

        res.json(users);
    } catch (err) {
        console.error('GET /admin/users Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/admin/users/:id  — Full user profile (admin only)
// ─────────────────────────────────────────────────────────────────────
router.get('/users/:id', authenticate, authorizeRoles('admin'), async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT u.id, u.name, u.email, u.role, u.phone, u.avatar, u.address,
                   u.status, u.created_at, u.updated_at,
                   tp.vehicle, tp.vehicle_capacity, tp.license_number,
                   tp.rating, tp.total_deliveries, tp.active_deliveries,
                    tp.earnings, tp.verified, tp.countries, tp.next_trip, tp.bio,
                   tp.terms_accepted, tp.terms_accepted_at
            FROM users u
            LEFT JOIN transporter_profiles tp ON tp.user_id = u.id
            WHERE u.id = ?
        `, [req.params.id]);

        if (rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });

        const user = rows[0];
        if (user.countries && typeof user.countries === 'string') {
            user.countries = JSON.parse(user.countries);
        }

        // Fetch trajectories
        const [trajectories] = await db.query(
            'SELECT * FROM transporter_trajectories WHERE transporter_id = ? ORDER BY created_at DESC',
            [req.params.id]
        );

        // Delivery summary
        const [[deliverySummary]] = await db.query(`
            SELECT COUNT(*) AS total,
                   SUM(status = 'Delivered') AS delivered,
                   SUM(status = 'Pending') AS pending,
                   SUM(status = 'Cancelled') AS cancelled,
                   COALESCE(SUM(price), 0) AS total_spent
            FROM deliveries
            WHERE ${user.role === 'client' ? 'client_id' : 'transporter_id'} = ?
        `, [req.params.id]);

        res.json({ ...user, delivery_summary: deliverySummary, trajectories });
    } catch (err) {
        console.error('GET /admin/users/:id Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/admin/users/:id/documents — Fetch documents for a transporter
// ─────────────────────────────────────────────────────────────────────
router.get('/users/:id/documents', authenticate, authorizeRoles('admin'), async (req, res) => {
    try {
        const [docs] = await db.query(
            'SELECT * FROM transporter_documents WHERE user_id = ? ORDER BY uploaded_at DESC',
            [req.params.id]
        );
        res.json(docs);
    } catch (err) {
        console.error('GET /admin/users/:id/documents Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/admin/users/:id/status — Suspend or re-activate a user
// ─────────────────────────────────────────────────────────────────────
router.patch('/users/:id/status', authenticate, authorizeRoles('admin'), async (req, res) => {
    const result = updateUserStatusSchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ error: 'Statut invalide', details: result.error.errors });
    }

    try {
        // Cannot suspend yourself
        if (req.params.id === req.user.id) {
            return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre statut' });
        }

        const [rows] = await db.query('SELECT id, role FROM users WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });

        // Cannot suspend another admin
        if (rows[0].role === 'admin') {
            return res.status(403).json({ error: 'Impossible de modifier le statut d\'un administrateur' });
        }

        await db.query('UPDATE users SET status = ? WHERE id = ?', [result.data.status, req.params.id]);

        res.json({
            message: `Utilisateur ${result.data.status === 'active' ? 'activé' : 'suspendu'} avec succès`,
            id: req.params.id,
            status: result.data.status,
        });
    } catch (err) {
        console.error('PATCH /admin/users/:id/status Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// DELETE /api/admin/users/:id — Permanently delete a user (use with care)
// ─────────────────────────────────────────────────────────────────────
router.delete('/users/:id', authenticate, authorizeRoles('admin'), async (req, res) => {
    try {
        if (req.params.id === req.user.id) {
            return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
        }

        const [rows] = await db.query("SELECT id, role FROM users WHERE id = ?", [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
        if (rows[0].role === 'admin') return res.status(403).json({ error: 'Impossible de supprimer un administrateur' });

        // This will cascade delete all related records (deliveries, messages, etc.)
        await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);

        res.json({ message: 'Utilisateur supprimé définitivement', id: req.params.id });
    } catch (err) {
        console.error('DELETE /admin/users/:id Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});


// ─────────────────────────────────────────────────────────────────────
// GET /api/admin/trajectories
// Admin: Get all trajectories (especially pending ones)
// ─────────────────────────────────────────────────────────────────────
router.get('/trajectories', authenticate, authorizeRoles('admin'), async (req, res) => {
    try {
        const status = req.query.status;
        let query = `
            SELECT t.*, u.name as transporter_name, u.email as transporter_email
            FROM transporter_trajectories t
            JOIN users u ON t.transporter_id = u.id
        `;
        const params = [];

        if (status) {
            query += ' WHERE t.status = ?';
            params.push(status);
        }

        query += ' ORDER BY t.created_at DESC';

        const [trajectories] = await db.query(query, params);
        res.json(trajectories);
    } catch (err) {
        console.error('GET /admin/trajectories Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/admin/trajectories/:id — Approve or Reject a trajectory
// ─────────────────────────────────────────────────────────────────────
router.patch('/trajectories/:id', authenticate, authorizeRoles('admin'), async (req, res) => {
    const { status } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
        return res.status(400).json({ error: 'Statut invalide' });
    }

    try {
        const [result] = await db.query(
            'UPDATE transporter_trajectories SET status = ? WHERE id = ?',
            [status, req.params.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Trajet introuvable' });
        }

        res.json({ message: `Trajet ${status === 'approved' ? 'approuvé' : 'rejeté'} avec succès`, id: req.params.id, status });
    } catch (err) {
        console.error('PATCH /admin/trajectories/:id Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/admin/reset-db — Reset entire database for testing
// ─────────────────────────────────────────────────────────────────────
router.post('/reset-db', authenticate, authorizeRoles('admin'), async (req, res) => {
    try {
        await db.query('SET FOREIGN_KEY_CHECKS = 0');
        const tables = [
            'reclamations', 'notifications', 'messages', 'ratings',
            'deliveries', 'voyages', 'transporter_trajectories',
            'transporter_documents', 'transporter_profiles', 'users'
        ];
        for (const table of tables) {
            await db.query(`DELETE FROM ${table}`);
        }
        // Re-seed Admin
        await db.query(`
            INSERT INTO users (id, name, email, password_hash, role, status)
            VALUES ('adm-0000-0000-0001', 'Admin RM Tawssil', 'admin@rmtawssil.com', '$2a$10$Jx4YYHOz4rWJlGH7vFKvmOQkbGl5H0H4Q9.6RJZV5w1.e.3Wf.xUa', 'admin', 'active')
        `);
        await db.query('SET FOREIGN_KEY_CHECKS = 1');
        res.json({ message: 'Database reset successfully' });
    } catch (err) {
        console.error('Reset DB Error:', err);
        res.status(500).json({ error: 'Failed to reset database' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/admin/transporters/freemium-limit
// Returns transporters who have used all 3 free conversations and are
// NOT subscribed — so admin can decide to unlock or permanently block.
// ─────────────────────────────────────────────────────────────────────
router.get('/transporters/freemium-limit', authenticate, authorizeRoles('admin'), async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT
                u.id, u.name, u.email, u.phone, u.avatar, u.created_at,
                tp.subscription_status, tp.messaging_disabled,
                COUNT(DISTINCT m.delivery_id) AS conversation_count,
                MAX(m.created_at) AS last_message_at
            FROM users u
            JOIN transporter_profiles tp ON tp.user_id = u.id
            LEFT JOIN messages m ON m.sender_id = u.id
            WHERE u.role = 'transporter'
              AND (tp.subscription_status IS NULL OR tp.subscription_status != 'active')
            GROUP BY u.id, u.name, u.email, u.phone, u.avatar, u.created_at,
                     tp.subscription_status, tp.messaging_disabled
            HAVING conversation_count >= 3
            ORDER BY last_message_at DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error('GET /admin/transporters/freemium-limit Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/admin/users/:id/messaging
// Enable or disable messaging access for a transporter
// ─────────────────────────────────────────────────────────────────────
router.patch('/users/:id/messaging', authenticate, authorizeRoles('admin'), async (req, res) => {
    const { disabled } = req.body;
    try {
        const [result] = await db.query(
            'UPDATE transporter_profiles SET messaging_disabled = ? WHERE user_id = ?',
            [disabled ? 1 : 0, req.params.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Profil transporteur introuvable' });
        }

        res.json({ message: `Messagerie ${disabled ? 'désactivée' : 'activée'} avec succès`, id: req.params.id, messaging_disabled: disabled });
    } catch (err) {
        console.error('PATCH /admin/users/:id/messaging Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/admin/transporters/pending
// Get list of transporters awaiting verification (verified = 0)
// ─────────────────────────────────────────────────────────────────────
router.get('/transporters/pending', authenticate, authorizeRoles('admin'), async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT u.id, u.name, u.email, u.phone, u.avatar, u.created_at,
                   tp.vehicle, tp.verified, tp.total_deliveries
            FROM users u
            JOIN transporter_profiles tp ON u.id = tp.user_id
            WHERE u.role = 'transporter' AND tp.verified = 0
            ORDER BY u.created_at DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error('GET /admin/transporters/pending Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/admin/transporters/:id/verify
// Update verification status of a transporter
// ─────────────────────────────────────────────────────────────────────
router.patch('/transporters/:id/verify', authenticate, authorizeRoles('admin'), async (req, res) => {
    const { verified } = req.body; // true or false
    try {
        const [result] = await db.query(
            'UPDATE transporter_profiles SET verified = ? WHERE user_id = ?',
            [verified ? 1 : 0, req.params.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Profil transporteur introuvable' });
        }

        res.json({ message: `Transporteur ${verified ? 'vérifié' : 'en attente'} avec succès`, id: req.params.id, verified });
    } catch (err) {
        console.error('PATCH /admin/transporters/:id/verify Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/admin/support-agents  — Create a new support agent (Admin only)
// ─────────────────────────────────────────────────────────────────────
router.post('/support-agents', authenticate, authorizeRoles('admin'), async (req, res) => {
    const result = createSupportSchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ error: 'Validation échouée', details: result.error.errors });
    }

    const { name, email, password, phone } = result.data;

    try {
        // Check if email already exists
        const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(409).json({ error: 'Cet email est déjà utilisé' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        const agentId = generateUUID();

        // Insert into users
        await db.query(
            'INSERT INTO users (id, name, email, password_hash, role, phone, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [agentId, name, email, passwordHash, 'support', phone || null, 'active']
        );

        res.status(201).json({
            message: 'Agent de support créé avec succès',
            agent: { id: agentId, name, email, role: 'support' }
        });
    } catch (err) {
        console.error('POST /admin/support-agents Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/admin/support-agents  — List all support agents
// ─────────────────────────────────────────────────────────────────────
router.get('/support-agents', authenticate, authorizeRoles('admin'), async (req, res) => {
    try {
        const [agents] = await db.query(
            "SELECT id, name, email, phone, status, created_at FROM users WHERE role = 'support' ORDER BY created_at DESC"
        );
        res.json(agents);
    } catch (err) {
        console.error('GET /admin/support-agents Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

module.exports = router;
