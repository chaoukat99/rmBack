const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const { generateUUID } = require('../utils/uuid');
const { createReclamationSchema, resolveReclamationSchema } = require('../utils/validations');

// ─────────────────────────────────────────────────────────────────────
// GET /api/reclamations
// - Client: sees their own reclamations
// - Admin: sees all reclamations (filter by status via ?status=open)
// ─────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
    try {
        const params = [];
        let whereClause = '';

        if (req.user.role === 'client') {
            whereClause = 'WHERE r.client_id = ?';
            params.push(req.user.id);
        } else if (req.user.role === 'admin' || req.user.role === 'support') {
            if (req.query.status) {
                whereClause = 'WHERE r.status = ?';
                params.push(req.query.status);
            }
        } else {
            return res.status(403).json({ error: 'Accès refusé' });
        }

        const [rows] = await db.query(`
            SELECT r.id, r.subject, r.description, r.status, r.admin_note,
                   r.created_at, r.updated_at,
                   c.name AS client_name, c.email AS client_email, c.phone AS client_phone,
                   d.tracking_code, d.origin, d.destination, d.status AS delivery_status
            FROM   reclamations r
            JOIN   users c     ON r.client_id = c.id
            JOIN   deliveries d ON r.delivery_id = d.id
            ${whereClause}
            ORDER BY r.created_at DESC
        `, params);

        res.json(rows);
    } catch (err) {
        console.error('GET /reclamations Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/reclamations/:id  — Get single reclamation detail
// ─────────────────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT r.*, c.name AS client_name, c.email AS client_email,
                   d.tracking_code, d.origin, d.destination, d.status AS delivery_status
            FROM   reclamations r
            JOIN   users c     ON r.client_id = c.id
            JOIN   deliveries d ON r.delivery_id = d.id
            WHERE  r.id = ?
        `, [req.params.id]);

        if (rows.length === 0) return res.status(404).json({ error: 'Réclamation introuvable' });

        const rec = rows[0];

        // Access control
        if (req.user.role === 'client' && rec.client_id !== req.user.id) {
            return res.status(403).json({ error: 'Accès refusé' });
        }

        res.json(rec);
    } catch (err) {
        console.error('GET /reclamations/:id Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/reclamations  — Submit a new reclamation (client only)
// ─────────────────────────────────────────────────────────────────────
router.post('/', authenticate, authorizeRoles('client'), async (req, res) => {
    const result = createReclamationSchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ error: 'Validation échouée', details: result.error.errors });
    }

    const { delivery_id, subject, description } = result.data;

    try {
        // Verify the delivery belongs to the client
        const [delivery] = await db.query(
            'SELECT id, status FROM deliveries WHERE id = ? AND client_id = ?',
            [delivery_id, req.user.id]
        );

        if (delivery.length === 0) {
            return res.status(404).json({ error: 'Livraison introuvable ou non autorisée' });
        }

        // Check if there's already an open reclamation for this delivery
        const [existing] = await db.query(
            'SELECT id FROM reclamations WHERE delivery_id = ? AND client_id = ? AND status = "open"',
            [delivery_id, req.user.id]
        );

        if (existing.length > 0) {
            return res.status(409).json({ error: 'Une réclamation est déjà ouverte pour cette livraison' });
        }

        const recId = generateUUID();
        await db.query(
            'INSERT INTO reclamations (id, client_id, delivery_id, subject, description) VALUES (?, ?, ?, ?, ?)',
            [recId, req.user.id, delivery_id, subject, description]
        );

        // Notify admins (simplified: just log — in prod, emit via socket or email)
        // Notify admin users
        const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin'");
        for (const admin of admins) {
            await db.query(
                'INSERT INTO notifications (id, user_id, type, title, body, delivery_id) VALUES (?, ?, ?, ?, ?, ?)',
                [
                    generateUUID(),
                    admin.id,
                    'reclamation',
                    '⚠️ Nouvelle Réclamation',
                    `Nouvelle réclamation: "${subject}"`,
                    delivery_id,
                ]
            );
        }

        res.status(201).json({
            message: 'Réclamation soumise avec succès',
            id: recId,
        });
    } catch (err) {
        console.error('POST /reclamations Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// PATCH /api/reclamations/:id/resolve  — Admin or Support resolves a reclamation
// ─────────────────────────────────────────────────────────────────────
router.patch('/:id/resolve', authenticate, authorizeRoles('admin', 'support'), async (req, res) => {
    const result = resolveReclamationSchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ error: 'Validation échouée', details: result.error.errors });
    }

    try {
        const [rows] = await db.query(
            'SELECT id, client_id, delivery_id, subject FROM reclamations WHERE id = ?',
            [req.params.id]
        );

        if (rows.length === 0) return res.status(404).json({ error: 'Réclamation introuvable' });

        const rec = rows[0];

        await db.query(
            'UPDATE reclamations SET status = "resolved", admin_note = ? WHERE id = ?',
            [result.data.admin_note || null, req.params.id]
        );

        // Notify the client
        await db.query(
            'INSERT INTO notifications (id, user_id, type, title, body, delivery_id) VALUES (?, ?, ?, ?, ?, ?)',
            [
                generateUUID(),
                rec.client_id,
                'reclamation_resolved',
                '✅ Réclamation Résolue',
                `Votre réclamation "${rec.subject}" a été résolue par notre équipe.`,
                rec.delivery_id,
            ]
        );

        res.json({ message: 'Réclamation résolue avec succès', id: req.params.id });
    } catch (err) {
        console.error('PATCH /reclamations/:id/resolve Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// PATCH /api/reclamations/:id/close  — Admin or Support closes a reclamation
// ─────────────────────────────────────────────────────────────────────
router.patch('/:id/close', authenticate, authorizeRoles('admin', 'support'), async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id FROM reclamations WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Réclamation introuvable' });

        await db.query(
            'UPDATE reclamations SET status = "closed" WHERE id = ?',
            [req.params.id]
        );

        res.json({ message: 'Réclamation clôturée', id: req.params.id });
    } catch (err) {
        console.error('PATCH /reclamations/:id/close Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

module.exports = router;
