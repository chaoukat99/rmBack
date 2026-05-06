const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const { generateUUID } = require('../utils/uuid');

// ─────────────────────────────────────────────────────────────────────
// GET /api/tickets — List support tickets
// ─────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
    try {
        const userId = req.user.role === 'admin' ? (req.query.userId || null) : req.user.id;
        let query = 'SELECT * FROM support_tickets';
        let params = [];

        if (userId) {
            query += ' WHERE user_id = ?';
            params.push(userId);
        } else if (req.user.role === 'admin' && req.query.status) {
            query += ' WHERE status = ?';
            params.push(req.query.status);
        }

        query += ' ORDER BY created_at DESC';

        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error('GET /tickets Error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/tickets — Create a new support ticket
// ─────────────────────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
    const { subject, message, category, priority } = req.body;
    if (!subject || !message) return res.status(400).json({ error: 'Sujet et message obligatoires' });

    try {
        const id = generateUUID();
        await db.query(
            'INSERT INTO support_tickets (id, user_id, subject, message, category, priority) VALUES (?, ?, ?, ?, ?, ?)',
            [id, req.user.id, subject, message, category || 'general', priority || 'medium']
        );

        res.status(201).json({ message: 'Ticket créé avec succès', id });
    } catch (err) {
        console.error('POST /tickets Error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/tickets/:id/status — Admin: Update ticket status
// ─────────────────────────────────────────────────────────────────────
router.patch('/:id/status', authenticate, authorizeRoles('admin'), async (req, res) => {
    const { status, admin_note } = req.body;
    try {
        await db.query(
            'UPDATE support_tickets SET status = ?, admin_note = ? WHERE id = ?',
            [status, admin_note || null, req.params.id]
        );
        res.json({ message: 'Ticket mis à jour' });
    } catch (err) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

module.exports = router;
