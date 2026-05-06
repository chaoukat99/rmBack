const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const { generateUUID } = require('../utils/uuid');
const { createTicketSchema, replyTicketSchema } = require('../utils/validations');
const uploadS3 = require('../middlewares/upload');

// ─────────────────────────────────────────────────────────────────────
// GET /api/support  — List tickets
// ─────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
    try {
        let rows;
        if (req.user.role === 'admin' || req.user.role === 'support') {
            [rows] = await db.query(`
                SELECT t.*, u.name as user_name, u.email as user_email 
                FROM support_tickets t 
                JOIN users u ON t.user_id = u.id 
                ORDER BY t.created_at DESC
            `);
        } else {
            [rows] = await db.query(`
                SELECT * FROM support_tickets 
                WHERE user_id = ? 
                ORDER BY created_at DESC
            `, [req.user.id]);
        }
        res.json(rows);
    } catch (err) {
        console.error('GET /support Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/support  — Create a new ticket
// ─────────────────────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
    const result = createTicketSchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ error: 'Validation échouée', details: result.error.errors });
    }

    const { subject, description } = result.data;
    const ticketId = generateUUID();

    try {
        await db.query(`
            INSERT INTO support_tickets (id, user_id, subject, description, status)
            VALUES (?, ?, ?, ?, 'open')
        `, [ticketId, req.user.id, subject, description]);

        // Notify admins + support agents
        const [staff] = await db.query("SELECT id FROM users WHERE role IN ('admin', 'support')");
        for (const s of staff) {
            await db.query(`
                INSERT INTO notifications (id, user_id, type, title, body)
                VALUES (?, ?, ?, ?, ?)
            `, [generateUUID(), s.id, 'support_ticket', '🎫 Nouveau ticket support', `Sujet: ${subject}`]);
        }

        // Emit new ticket event to all support staff via Socket.IO
        const io = req.app.get('io');
        if (io) {
            io.to('support_staff').emit('new_ticket', { ticketId, subject, userId: req.user.id });
        }

        res.status(201).json({ message: 'Ticket créé avec succès', id: ticketId });
    } catch (err) {
        console.error('POST /support Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/support/:id/reply  — Admin or Support replies (legacy)
// ─────────────────────────────────────────────────────────────────────
router.patch('/:id/reply', authenticate, authorizeRoles('admin', 'support'), async (req, res) => {
    const result = replyTicketSchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ error: 'Validation échouée', details: result.error.errors });
    }

    try {
        const [ticket] = await db.query('SELECT user_id, subject FROM support_tickets WHERE id = ?', [req.params.id]);
        if (ticket.length === 0) return res.status(404).json({ error: 'Ticket introuvable' });

        await db.query(`
            UPDATE support_tickets 
            SET admin_reply = ?, status = 'replied' 
            WHERE id = ?
        `, [result.data.admin_reply, req.params.id]);

        await db.query(`
            INSERT INTO notifications (id, user_id, type, title, body)
            VALUES (?, ?, ?, ?, ?)
        `, [generateUUID(), ticket[0].user_id, 'support_reply', '📬 Réponse au support',
            `Une réponse a été apportée à votre ticket : ${ticket[0].subject}`]);

        res.json({ message: 'Réponse envoyée' });
    } catch (err) {
        console.error('PATCH /support/reply Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/support/:id/close  — Close ticket
// ─────────────────────────────────────────────────────────────────────
router.patch('/:id/close', authenticate, async (req, res) => {
    try {
        const [ticket] = await db.query('SELECT user_id FROM support_tickets WHERE id = ?', [req.params.id]);
        if (ticket.length === 0) return res.status(404).json({ error: 'Ticket introuvable' });

        if (req.user.role !== 'admin' && req.user.role !== 'support' && ticket[0].user_id !== req.user.id) {
            return res.status(403).json({ error: 'Accès refusé' });
        }

        await db.query("UPDATE support_tickets SET status = 'closed' WHERE id = ?", [req.params.id]);
        
        const io = req.app.get('io');
        if (io) io.to(`ticket_${req.params.id}`).emit('ticket_closed', { ticketId: req.params.id });

        res.json({ message: 'Ticket clôturé' });
    } catch (err) {
        console.error('PATCH /support/close Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/support/:id  — Get single ticket details
// ─────────────────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT t.*, u.name as user_name, u.email as user_email, u.phone as user_phone
            FROM support_tickets t
            JOIN users u ON t.user_id = u.id
            WHERE t.id = ?
        `, [req.params.id]);

        if (rows.length === 0) return res.status(404).json({ error: 'Ticket introuvable' });

        const ticket = rows[0];
        if (req.user.role !== 'admin' && req.user.role !== 'support' && ticket.user_id !== req.user.id) {
            return res.status(403).json({ error: 'Accès refusé' });
        }

        res.json(ticket);
    } catch (err) {
        console.error('GET /support/:id Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/support/:id/messages  — Get chat history for a ticket
// ─────────────────────────────────────────────────────────────────────
router.get('/:id/messages', authenticate, async (req, res) => {
    try {
        const [ticket] = await db.query('SELECT user_id FROM support_tickets WHERE id = ?', [req.params.id]);
        if (ticket.length === 0) return res.status(404).json({ error: 'Ticket introuvable' });

        if (req.user.role !== 'admin' && req.user.role !== 'support' && ticket[0].user_id !== req.user.id) {
            return res.status(403).json({ error: 'Accès refusé' });
        }

        const [messages] = await db.query(`
            SELECT sm.id, sm.ticket_id, sm.sender_id, sm.content, sm.message_type,
                   sm.file_url, sm.file_size, sm.created_at,
                   u.name as sender_name, u.role as sender_role, u.avatar as sender_avatar
            FROM support_messages sm
            JOIN users u ON sm.sender_id = u.id
            WHERE sm.ticket_id = ?
            ORDER BY sm.created_at ASC
        `, [req.params.id]);

        res.json(messages);
    } catch (err) {
        console.error('GET /support/:id/messages Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/support/:id/messages  — Send a message (text, image, audio, file)
// ─────────────────────────────────────────────────────────────────────
router.post('/:id/messages', authenticate, uploadS3.single('file'), async (req, res) => {
    try {
        const [ticket] = await db.query('SELECT user_id, status FROM support_tickets WHERE id = ?', [req.params.id]);
        if (ticket.length === 0) return res.status(404).json({ error: 'Ticket introuvable' });

        if (req.user.role !== 'admin' && req.user.role !== 'support' && ticket[0].user_id !== req.user.id) {
            return res.status(403).json({ error: 'Accès refusé' });
        }

        let content = req.body.content || null;
        let messageType = req.body.message_type || 'text';
        let fileUrl = null;
        let fileSize = null;

        // Handle file upload (image / audio / document)
        if (req.file) {
            fileUrl = req.file.location; // S3 URL
            fileSize = req.file.size;
            // Auto-detect type from mimetype if not explicitly provided
            if (!req.body.message_type || req.body.message_type === 'text') {
                if (req.file.mimetype.startsWith('image/')) messageType = 'image';
                else if (req.file.mimetype.startsWith('audio/')) messageType = 'audio';
                else messageType = 'file';
            }
            // For file/image/audio, file_url IS the content if no text
            if (!content) content = fileUrl;
        }

        if (!content && !fileUrl) {
            return res.status(400).json({ error: 'Le message ne peut pas être vide' });
        }

        const messageId = generateUUID();
        await db.query(`
            INSERT INTO support_messages (id, ticket_id, sender_id, content, message_type, file_url, file_size)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [messageId, req.params.id, req.user.id, content, messageType, fileUrl, fileSize]);

        // Update ticket status
        if (req.user.role === 'admin' || req.user.role === 'support') {
            await db.query("UPDATE support_tickets SET status = 'replied' WHERE id = ?", [req.params.id]);
        } else if (ticket[0].status === 'closed') {
            await db.query("UPDATE support_tickets SET status = 'open' WHERE id = ?", [req.params.id]);
        }

        // Fetch full message with sender info
        const [newMsg] = await db.query(`
            SELECT sm.id, sm.ticket_id, sm.sender_id, sm.content, sm.message_type,
                   sm.file_url, sm.file_size, sm.created_at,
                   u.name as sender_name, u.role as sender_role, u.avatar as sender_avatar
            FROM support_messages sm
            JOIN users u ON sm.sender_id = u.id
            WHERE sm.id = ?
        `, [messageId]);

        const message = newMsg[0];

        // Emit to ticket room via Socket.IO (real-time)
        const io = req.app.get('io');
        if (io) {
            io.to(`ticket_${req.params.id}`).emit('support_message', message);
        }

        // Notify the other party
        let notifyUserId = null;
        if (req.user.role === 'admin' || req.user.role === 'support') {
            notifyUserId = ticket[0].user_id;
        } else {
            // Notify support staff
            const [staff] = await db.query("SELECT id FROM users WHERE role IN ('admin', 'support') LIMIT 1");
            if (staff.length > 0) notifyUserId = staff[0].id;
        }

        if (notifyUserId) {
            await db.query(`
                INSERT INTO notifications (id, user_id, type, title, body)
                VALUES (?, ?, ?, ?, ?)
            `, [generateUUID(), notifyUserId, 'support_message', '💬 Nouveau message support',
                `${req.user.name || 'Un utilisateur'} vous a envoyé un message.`]);
        }

        res.status(201).json(message);
    } catch (err) {
        console.error('POST /support/:id/messages Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

module.exports = router;
