const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate } = require('../middlewares/auth');

// ─────────────────────────────────────────────────────────────────────
// GET /api/notifications
// Get all notifications for the current user, newest first
// ─────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const onlyUnread = req.query.unread === 'true';

        let sql = `
            SELECT n.id, n.type, n.title, n.body, n.is_read, n.created_at,
                   n.delivery_id,
                   d.tracking_code, d.origin, d.destination
            FROM   notifications n
            LEFT   JOIN deliveries d ON d.id = n.delivery_id
            WHERE  n.user_id = ?
        `;
        const params = [req.user.id];

        if (onlyUnread) {
            sql += ' AND n.is_read = FALSE';
        }

        sql += ' ORDER BY n.created_at DESC LIMIT ?';
        params.push(limit);

        const [notifications] = await db.query(sql, params);

        // Unread count
        const [[{ unread_count }]] = await db.query(
            'SELECT COUNT(*) AS unread_count FROM notifications WHERE user_id = ? AND is_read = FALSE',
            [req.user.id]
        );

        res.json({ notifications, unread_count });
    } catch (err) {
        console.error('GET /notifications Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/notifications/read-all
// Mark ALL notifications as read for the current user
// ─────────────────────────────────────────────────────────────────────
router.patch('/read-all', authenticate, async (req, res) => {
    try {
        const [result] = await db.query(
            'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE',
            [req.user.id]
        );
        res.json({
            message: 'Toutes les notifications marquées comme lues',
            updated_count: result.affectedRows,
        });
    } catch (err) {
        console.error('PATCH /notifications/read-all Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/notifications/:id/read
// Mark a single notification as read — must belong to current user
// ─────────────────────────────────────────────────────────────────────
router.patch('/:id/read', authenticate, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT id FROM notifications WHERE id = ? AND user_id = ?',
            [req.params.id, req.user.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Notification introuvable' });
        }

        await db.query(
            'UPDATE notifications SET is_read = TRUE WHERE id = ?',
            [req.params.id]
        );

        res.json({ message: 'Notification marquée comme lue', id: req.params.id });
    } catch (err) {
        console.error('PATCH /notifications/:id/read Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// DELETE /api/notifications/:id — Delete a single notification
// ─────────────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const [result] = await db.query(
            'DELETE FROM notifications WHERE id = ? AND user_id = ?',
            [req.params.id, req.user.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Notification introuvable' });
        }

        res.json({ message: 'Notification supprimée' });
    } catch (err) {
        console.error('DELETE /notifications/:id Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

module.exports = router;
