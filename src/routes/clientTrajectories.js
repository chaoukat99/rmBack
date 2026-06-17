const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const { generateUUID } = require('../utils/uuid');
const { createClientTrajectorySchema } = require('../utils/validations');

const MAX_CLIENT_TRAJECTORIES = 5;

// ─────────────────────────────────────────────────────────────────────
// GET /api/client-trajectories/me
// Client: list my own "request voyage" trajectories.
// ─────────────────────────────────────────────────────────────────────
router.get('/me', authenticate, authorizeRoles('client'), async (req, res) => {
    try {
        const [rows] = await db.query(
            "SELECT * FROM client_trajectories WHERE client_id = ? AND status = 'active' ORDER BY created_at DESC",
            [req.user.id]
        );
        res.json(rows);
    } catch (err) {
        console.error('GET /client-trajectories/me Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/client-trajectories
// Client: add a new trajectory (max 5 active).
// ─────────────────────────────────────────────────────────────────────
router.post('/', authenticate, authorizeRoles('client'), async (req, res) => {
    const result = createClientTrajectorySchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ error: 'Validation échouée', details: result.error.errors });
    }
    const { from_country, from_city, to_country, to_city } = result.data;

    try {
        const [[{ count }]] = await db.query(
            "SELECT COUNT(*) AS count FROM client_trajectories WHERE client_id = ? AND status = 'active'",
            [req.user.id]
        );
        if (count >= MAX_CLIENT_TRAJECTORIES) {
            return res.status(400).json({ error: `Vous ne pouvez pas ajouter plus de ${MAX_CLIENT_TRAJECTORIES} trajets.` });
        }

        // Avoid exact duplicates (same route already active)
        const [dupes] = await db.query(
            "SELECT id FROM client_trajectories WHERE client_id = ? AND from_city = ? AND to_city = ? AND status = 'active'",
            [req.user.id, from_city, to_city]
        );
        if (dupes.length > 0) {
            return res.status(409).json({ error: 'Ce trajet existe déjà.' });
        }

        const id = generateUUID();
        await db.query(
            'INSERT INTO client_trajectories (id, client_id, from_country, from_city, to_country, to_city) VALUES (?, ?, ?, ?, ?, ?)',
            [id, req.user.id, from_country, from_city, to_country, to_city]
        );

        const [[row]] = await db.query('SELECT * FROM client_trajectories WHERE id = ?', [id]);
        res.status(201).json(row);
    } catch (err) {
        console.error('POST /client-trajectories Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// DELETE /api/client-trajectories/:id
// Client: remove one of their own trajectories.
// ─────────────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, authorizeRoles('client'), async (req, res) => {
    try {
        const [result] = await db.query(
            'DELETE FROM client_trajectories WHERE id = ? AND client_id = ?',
            [req.params.id, req.user.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Trajet introuvable' });
        }
        res.json({ message: 'Trajet supprimé' });
    } catch (err) {
        console.error('DELETE /client-trajectories/:id Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/client-trajectories
// Transporter/Admin: list all active client "request voyage" trajectories.
// For transporters, each row is annotated with `can_chat` — true when the
// route (from_city + to_city) matches one of their APPROVED trajectories.
// Otherwise the transporter sees it read-only.
// ─────────────────────────────────────────────────────────────────────
router.get('/', authenticate, authorizeRoles('transporter', 'admin'), async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT ct.*, u.name AS client_name, u.avatar AS client_avatar, u.phone AS client_phone
            FROM   client_trajectories ct
            JOIN   users u ON ct.client_id = u.id
            WHERE  ct.status = 'active' AND u.status != 'suspended'
            ORDER BY ct.created_at DESC
        `);

        if (req.user.role !== 'transporter') {
            return res.json(rows.map((r) => ({ ...r, can_chat: false })));
        }

        // Build a lookup of the transporter's approved routes (city-pair, case-insensitive)
        const [approved] = await db.query(
            "SELECT from_city, to_city FROM transporter_trajectories WHERE transporter_id = ? AND status = 'approved'",
            [req.user.id]
        );
        const routeKey = (from, to) => `${(from || '').trim().toLowerCase()}→${(to || '').trim().toLowerCase()}`;
        const myRoutes = new Set(approved.map((t) => routeKey(t.from_city, t.to_city)));

        const annotated = rows.map((r) => ({
            ...r,
            can_chat: myRoutes.has(routeKey(r.from_city, r.to_city)),
        }));
        res.json(annotated);
    } catch (err) {
        console.error('GET /client-trajectories Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

module.exports = router;
