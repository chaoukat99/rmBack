const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const { generateUUID } = require('../utils/uuid');
const uploadS3 = require('../middlewares/upload');

// 1. POST /api/subscriptions - Upload payment receipt
router.post('/', authenticate, uploadS3.single('receipt'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Reçu manquant' });
        
        const subId = generateUUID();
        const receiptUrl = req.file.location; // Use S3 URL instead of local path

        // Create subscription request
        await db.query(`
            INSERT INTO transporter_subscriptions (id, user_id, receipt_url, status)
            VALUES (?, ?, ?, 'pending')
        `, [subId, req.user.id, receiptUrl]);

        // Update profile status as well to show its pending in UI
        await db.query(`
            UPDATE transporter_profiles SET subscription_status = 'pending' WHERE user_id = ?
        `, [req.user.id]);

        res.status(201).json({ message: 'Reçu envoyé avec succès', id: subId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 2. GET /api/subscriptions/me - Check my status
router.get('/me', authenticate, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM transporter_subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [req.user.id]);
        res.json(rows[0] || null);
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 3. GET /api/subscriptions - Admin: List all
router.get('/', authenticate, authorizeRoles('admin'), async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT s.*, u.name as userName, u.email as userEmail 
            FROM transporter_subscriptions s
            JOIN users u ON s.user_id = u.id
            ORDER BY s.created_at DESC
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 4. PATCH /api/subscriptions/:id/status - Admin: Approve/Reject
router.patch('/:id/status', authenticate, authorizeRoles('admin'), async (req, res) => {
    const { status, adminNote } = req.body;
    try {
        const [subs] = await db.query('SELECT user_id FROM transporter_subscriptions WHERE id = ?', [req.params.id]);
        if (subs.length === 0) return res.status(404).json({ error: 'Abonnement introuvable' });

        const userId = subs[0].user_id;

        if (status === 'approved') {
            const activatedAt = new Date();
            const expiresAt = new Date();
            expiresAt.setMonth(expiresAt.getMonth() + 1); // 1 month duration

            await db.query(`
                UPDATE transporter_subscriptions 
                SET status = 'approved', 
                    admin_note = ?, 
                    activated_at = ?, 
                    expires_at = ?,
                    updated_at = NOW() 
                WHERE id = ?
            `, [adminNote || 'Approuvé par Admin', activatedAt, expiresAt, req.params.id]);

            await db.query(`
                UPDATE transporter_profiles 
                SET subscription_status = 'active', 
                    subscription_expires_at = ? 
                WHERE user_id = ?
            `, [expiresAt, userId]);

        } else if (status === 'rejected') {
            await db.query(`
                UPDATE transporter_subscriptions 
                SET status = 'rejected', admin_note = ?, updated_at = NOW() 
                WHERE id = ?
            `, [adminNote || 'Reçu non valide', req.params.id]);

            await db.query('UPDATE transporter_profiles SET subscription_status = "none" WHERE user_id = ?', [userId]);
        }

        res.json({ message: 'Statut mis à jour' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
