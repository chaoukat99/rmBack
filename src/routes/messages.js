const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const { generateUUID } = require('../utils/uuid');
const { sendMessageSchema } = require('../utils/validations');
const uploadS3 = require('../middlewares/upload');
const QRCode = require('qrcode');
const puppeteer = require('puppeteer-core');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/s3');
const { notifyUsers } = require('../utils/pushNotifications');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const BUCKET = process.env.AWS_BUCKET_NAME;
const REGION = process.env.AWS_REGION || 'eu-west-3';

// Helper: upload a Buffer to S3 and return public URL
async function uploadBufferToS3(buffer, key, contentType) {
    await s3Client.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
    }));
    return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
}

// Helper: verify user is part of a delivery (returns delivery row or throws)
async function assertDeliveryAccess(deliveryId, userId, role) {
    const [rows] = await db.query(
        'SELECT client_id, transporter_id FROM deliveries WHERE id = ?',
        [deliveryId]
    );
    if (rows.length === 0) throw Object.assign(new Error('Livraison introuvable'), { status: 404 });
    const d = rows[0];
    const ok = role === 'admin' || role === 'support' || userId === d.client_id || userId === d.transporter_id;
    if (!ok) throw Object.assign(new Error('Accès refusé'), { status: 403 });
    return d;
}


// ─────────────────────────────────────────────────────────────────────
// GET /api/messages/unread/count
// Get total unread messages count for the current user
// ─────────────────────────────────────────────────────────────────────
router.get('/unread/count', authenticate, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT COUNT(*) AS unread_count FROM messages WHERE recipient_id = ? AND is_read = FALSE',
            [req.user.id]
        );
        res.json({ unread_count: rows[0].unread_count });
    } catch (err) {
        console.error('GET /messages/unread/count Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/messages/conversations
// Returns all chat conversations for the current user,
// grouped by delivery, with last message + unread count.
// ─────────────────────────────────────────────────────────────────────
router.get('/conversations', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const role   = req.user.role;

        let whereClause = '';
        let queryParams = [userId]; // first ? is for unread_count subquery

        if (role === 'client') {
            whereClause = 'WHERE d.client_id = ?';
            queryParams.push(userId);
        } else if (role === 'transporter') {
            whereClause = 'WHERE d.transporter_id = ?';
            queryParams.push(userId);
        }


        const [rows] = await db.query(`
            SELECT
                d.id AS delivery_id, d.origin, d.destination, d.status, d.created_at,
                c.name AS client_name, c.avatar AS client_avatar,
                t.name AS transporter_name, t.avatar AS transporter_avatar,
                t.id AS transporter_id, c.id AS client_id,
                (SELECT content FROM messages WHERE delivery_id = d.id ORDER BY created_at DESC LIMIT 1) as last_message,
                (SELECT message_type FROM messages WHERE delivery_id = d.id ORDER BY created_at DESC LIMIT 1) as last_message_type,
                (SELECT created_at FROM messages WHERE delivery_id = d.id ORDER BY created_at DESC LIMIT 1) as last_message_at,
                (SELECT COUNT(*) FROM messages WHERE delivery_id = d.id AND recipient_id = ? AND is_read = FALSE) as unread_count
            FROM deliveries d
            LEFT JOIN users c ON d.client_id = c.id
            LEFT JOIN users t ON d.transporter_id = t.id
            ${whereClause}
            ORDER BY last_message_at DESC, d.created_at DESC
        `, queryParams);

        res.json(rows);
    } catch (err) {
        console.error('GET /messages/conversations Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur', details: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/messages/:deliveryId
// Get all messages for a specific delivery
// Only the assigned client and transporter can read (NO auto-assignment)
// ─────────────────────────────────────────────────────────────────────
router.get('/:deliveryId', authenticate, async (req, res) => {
    try {
        const [delivery] = await db.query(
            'SELECT client_id, transporter_id FROM deliveries WHERE id = ?',
            [req.params.deliveryId]
        );

        if (delivery.length === 0) {
            return res.status(404).json({ error: 'Livraison introuvable' });
        }

        const d = delivery[0];

        // STRICT access: only actual participants + admin/support
        // ⚠️  NO auto-assignment here — prevents exploit via delivery details screen
        const authorized =
            req.user.role === 'admin' ||
            req.user.role === 'support' ||
            req.user.id === d.client_id ||
            req.user.id === d.transporter_id;

        if (!authorized) {
            return res.status(403).json({ error: 'Accès refusé' });
        }

        // ── Freemium guard on READ for transporters ──────────────────────────
        // If the transporter is not subscribed and has already reached 3 unique
        // conversations (deliveries), block them from opening a new one.
        if (req.user.role === 'transporter' && req.user.id === d.transporter_id) {
            const [profiles] = await db.query(
                'SELECT messaging_disabled, subscription_status, subscription_expires_at FROM transporter_profiles WHERE user_id = ?',
                [req.user.id]
            );
            const profile = profiles[0];

            if (profile && profile.messaging_disabled) {
                return res.status(403).json({
                    error: 'Accès restreint',
                    details: 'Votre accès à la messagerie a été désactivé par l\'administrateur.',
                    messagingDisabled: true
                });
            }

            const isSubscribed = profile &&
                profile.subscription_status === 'active' &&
                (!profile.subscription_expires_at || new Date(profile.subscription_expires_at) > new Date());

            if (!isSubscribed) {
                // Count distinct conversations where this transporter has SENT at least one message
                const [msgCounts] = await db.query(
                    'SELECT COUNT(DISTINCT delivery_id) AS conversation_count FROM messages WHERE sender_id = ?',
                    [req.user.id]
                );
                const [thisMsgCount] = await db.query(
                    'SELECT COUNT(*) AS count FROM messages WHERE sender_id = ? AND delivery_id = ?',
                    [req.user.id, req.params.deliveryId]
                );
                const conversationCount = msgCounts[0].conversation_count || 0;
                const hasParticipated = thisMsgCount[0].count > 0;

                // Block opening a 4th conversation (read + write)
                if (conversationCount >= 3 && !hasParticipated) {
                    return res.status(403).json({
                        error: 'Limite de conversations atteinte',
                        details: 'Vous avez atteint la limite de 3 conversations gratuites. Activez votre abonnement Premium pour continuer.',
                        requiresSubscription: true,
                        conversationCount
                    });
                }
            }
        }

        const [messages] = await db.query(`
            SELECT  m.id, m.content, m.message_type, m.file_size, m.is_read, m.created_at,
                    m.sender_id, m.recipient_id,
                    s.name AS sender_name, s.avatar AS sender_avatar,
                    s.role AS sender_role
            FROM    messages m
            JOIN    users s ON m.sender_id = s.id
            WHERE   m.delivery_id = ?
            ORDER BY m.created_at ASC
        `, [req.params.deliveryId]);

        res.json(messages);
    } catch (err) {
        console.error('GET /messages/:deliveryId Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/messages/:deliveryId
// Send a new message
// Also emits via Socket.IO if io is available on req.app
// ─────────────────────────────────────────────────────────────────────
router.post('/:deliveryId', authenticate, uploadS3.single('file'), async (req, res) => {
    // If it's a file upload, body fields are strings from FormData
    const result = sendMessageSchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ error: 'Validation échouée', details: result.error.errors });
    }

    let { content, recipient_id, message_type } = result.data;
    let fileSize = null;

    if (req.file) {
        // Fallback to path if location (S3) is not available
        content = req.file.location || req.file.path; 
        fileSize = req.file.size;
        // If message_type wasn't explicitly sent, try to guess from mimetype
        if (!req.body.message_type || req.body.message_type === 'text') {
            if (req.file.mimetype.startsWith('image/')) message_type = 'image';
            else if (req.file.mimetype.startsWith('audio/')) message_type = 'audio';
            else message_type = 'file';
        }
    }

    if (!content && !req.file) {

        return res.status(400).json({ error: 'Le message ne peut pas être vide' });
    }

    try {
        // Verify sender is part of this delivery
        const [delivery] = await db.query(
            'SELECT client_id, transporter_id FROM deliveries WHERE id = ?',
            [req.params.deliveryId]
        );

        if (delivery.length === 0) {
            return res.status(404).json({ error: 'Livraison introuvable' });
        }

        const d = delivery[0];

        // STRICT access: no auto-assignment on message send
        // Transporter must be explicitly assigned via the accept flow on the dashboard
        const authorized =
            req.user.role === 'admin' ||
            req.user.role === 'support' ||
            req.user.id === d.client_id ||
            req.user.id === d.transporter_id;

        if (!authorized) {
            return res.status(403).json({ error: 'Accès refusé' });
        }

        // ─────────────────────────────────────────────────────────────────────
        // ACCESS CONTROL: Check if transporter's messaging is disabled by Admin
        // ─────────────────────────────────────────────────────────────────────
        if (req.user.role === 'transporter') {
            const [profiles] = await db.query('SELECT messaging_disabled, subscription_status, subscription_expires_at FROM transporter_profiles WHERE user_id = ?', [req.user.id]);
            const profile = profiles[0];

            if (profile && profile.messaging_disabled) {
                return res.status(403).json({ 
                    error: 'Accès restreint', 
                    details: 'Votre accès à la messagerie a été désactivé par l\'administrateur. Vous pouvez toujours consulter les demandes.' 
                });
            }
            
            const isSubscribed = profile && profile.subscription_status === 'active' && 
                               (!profile.subscription_expires_at || new Date(profile.subscription_expires_at) > new Date());

            // Limit to 3 conversations (unique deliveries) if not active
            if (!isSubscribed) {
                const [msgCounts] = await db.query(
                    'SELECT COUNT(DISTINCT delivery_id) AS conversation_count FROM messages WHERE sender_id = ?',
                    [req.user.id]
                );
                
                const [thisMsgCount] = await db.query(
                    'SELECT COUNT(*) AS count FROM messages WHERE sender_id = ? AND delivery_id = ?',
                    [req.user.id, req.params.deliveryId]
                );

                const conversationCount = msgCounts[0].conversation_count || 0;
                const hasParticipated = thisMsgCount[0].count > 0;

                if (conversationCount >= 3 && !hasParticipated) {
                    return res.status(403).json({ 
                        error: 'Limite de conversations atteinte', 
                        details: 'Vous avez atteint la limite de 3 conversations gratuites. Pour discuter avec de nouveaux clients, activez votre abonnement Premium (2000 MAD).',
                        rib: 'XXXXXXXXXXXXX',
                        requiresSubscription: true
                    });
                }
            }

            // AUTO-LOCK LEAD: If the transporter starts chatting, assign them and hide from others
            if (!d.transporter_id) {
                await db.query('UPDATE deliveries SET transporter_id = ?, status = "Accepted" WHERE id = ?', [req.user.id, req.params.deliveryId]);
            }
        }

        // Verify recipient exists
        const [recipient] = await db.query('SELECT id, name FROM users WHERE id = ?', [recipient_id]);
        if (recipient.length === 0) {
            return res.status(404).json({ error: 'Destinataire introuvable' });
        }

        const messageId = generateUUID();

        await db.query(
            'INSERT INTO messages (id, delivery_id, sender_id, recipient_id, content, message_type, file_size) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [messageId, req.params.deliveryId, req.user.id, recipient_id, content, message_type, fileSize]
        );

        // Fetch the created message with sender info for response + emit
        const [newMsg] = await db.query(`
            SELECT m.id, m.content, m.message_type, m.file_size, m.is_read, m.created_at,
                   m.sender_id, m.recipient_id,
                   s.name AS sender_name, s.avatar AS sender_avatar, s.role AS sender_role
            FROM   messages m
            JOIN   users s ON m.sender_id = s.id
            WHERE  m.id = ?
        `, [messageId]);

        const message = newMsg[0];

        // Emit to delivery room via Socket.IO
        const io = req.app.get('io');
        if (io) {
            io.to(req.params.deliveryId).emit('receive_message', message);
        }

        // Create a notification for the recipient
        const [senderUser] = await db.query('SELECT name FROM users WHERE id = ?', [req.user.id]);
        const notificationId = generateUUID();
        const senderName = senderUser[0]?.name || 'Un utilisateur';
        const notifTitle = '💬 Nouveau Message';
        const notifBody = `${senderName} vous a envoyé un message.`;
        await db.query(
            'INSERT INTO notifications (id, user_id, type, title, body, delivery_id) VALUES (?, ?, ?, ?, ?, ?)',
            [notificationId, recipient_id, 'message', notifTitle, notifBody, req.params.deliveryId]
        );

        // Real-time push to the recipient's personal room so the bell/toast
        // update even when they are not viewing this conversation.
        if (io) {
            io.to(`user_${recipient_id}`).emit('notification', {
                id: notificationId,
                type: 'message',
                title: notifTitle,
                body: notifBody,
                message: notifBody,
                delivery_id: req.params.deliveryId,
                is_read: 0,
                created_at: new Date().toISOString(),
            });
        }

        res.status(201).json(message);
    } catch (err) {
        console.error('POST /messages/:deliveryId Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/messages/:deliveryId/read
// Mark all messages in a delivery conversation as read for the current user
// ─────────────────────────────────────────────────────────────────────
router.patch('/:deliveryId/read', authenticate, async (req, res) => {
    try {
        const [result] = await db.query(
            'UPDATE messages SET is_read = TRUE WHERE delivery_id = ? AND recipient_id = ? AND is_read = FALSE',
            [req.params.deliveryId, req.user.id]
        );

        res.json({
            message: 'Messages marqués comme lus',
            updated_count: result.affectedRows,
        });
    } catch (err) {
        console.error('PATCH /messages/:deliveryId/read Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});



// ─────────────────────────────────────────────────────────────────────
// POST /api/messages/:deliveryId/form-request
// Transporter sends a "fill pickup form" card to the client.
// Creates a form_request message visible to both parties.
// ─────────────────────────────────────────────────────────────────────
router.post('/:deliveryId/form-request', authenticate, authorizeRoles('transporter'), async (req, res) => {
    try {
        const d = await assertDeliveryAccess(req.params.deliveryId, req.user.id, req.user.role);

        if (!d.transporter_id || d.transporter_id !== req.user.id) {
            return res.status(403).json({ error: 'Vous devez être le transporteur assigné à cette livraison' });
        }

        // Check if restricted
        const [profiles] = await db.query('SELECT messaging_disabled FROM transporter_profiles WHERE user_id = ?', [req.user.id]);
        if (profiles[0]?.messaging_disabled) {
            return res.status(403).json({ error: 'Accès restreint', details: 'Accès désactivé par l\'administrateur' });
        }

        // Check if form_request already sent
        const [existing] = await db.query(
            "SELECT id FROM messages WHERE delivery_id = ? AND message_type = 'form_request' LIMIT 1",
            [req.params.deliveryId]
        );
        if (existing.length > 0) {
            return res.status(409).json({ error: 'Formulaire déjà envoyé au client' });
        }

        const msgId = generateUUID();
        await db.query(
            `INSERT INTO messages (id, delivery_id, sender_id, recipient_id, content, message_type)
             VALUES (?, ?, ?, ?, ?, 'form_request')`,
            [msgId, req.params.deliveryId, req.user.id, d.client_id,
             'Veuillez remplir vos informations de ramassage']
        );

        // Fetch full message for emit
        const [newMsg] = await db.query(`
            SELECT m.*, s.name AS sender_name, s.avatar AS sender_avatar, s.role AS sender_role
            FROM messages m JOIN users s ON m.sender_id = s.id WHERE m.id = ?
        `, [msgId]);
        const message = newMsg[0];

        const io = req.app.get('io');
        if (io) io.to(req.params.deliveryId).emit('receive_message', message);

        // DB notification
        await db.query(
            'INSERT INTO notifications (id, user_id, type, title, body, delivery_id, reference_id) VALUES (UUID(),?,?,?,?,?,?)',
            [d.client_id, 'form_request', '📋 Formulaire de ramassage',
             'Votre transporteur vous demande de remplir vos informations de ramassage.',
             req.params.deliveryId, msgId]
        );

        // Push notification
        await notifyUsers(db, [d.client_id],
            '📋 Formulaire de ramassage',
            'Votre transporteur vous demande de remplir vos informations.',
            { screen: 'Chat', deliveryId: req.params.deliveryId }
        );

        res.status(201).json(message);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        console.error('POST /messages/:id/form-request Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/messages/:deliveryId/pickup-form
// Client fills and submits the pickup information form.
// Saves to pickup_forms table + sends a pickup_form message.
// ─────────────────────────────────────────────────────────────────────
router.post('/:deliveryId/pickup-form', authenticate, authorizeRoles('client'), async (req, res) => {
    try {
        const d = await assertDeliveryAccess(req.params.deliveryId, req.user.id, req.user.role);

        if (d.client_id !== req.user.id) {
            return res.status(403).json({ error: 'Accès refusé' });
        }

        const {
            sender_name, sender_phone, sender_address,
            recipient_name, recipient_phone, recipient_address,
            parcel_description, parcel_weight, special_instructions,
        } = req.body;

        // Basic validation
        if (!sender_name || !sender_phone || !recipient_name || !recipient_phone) {
            return res.status(400).json({
                error: 'Informations incomplètes',
                details: 'Nom et téléphone de l\'expéditeur et du destinataire sont obligatoires'
            });
        }

        // Check if already submitted
        const [existingForm] = await db.query(
            'SELECT id FROM pickup_forms WHERE delivery_id = ? LIMIT 1',
            [req.params.deliveryId]
        );
        if (existingForm.length > 0) {
            return res.status(409).json({ error: 'Formulaire déjà soumis pour cette livraison' });
        }

        const formId = generateUUID();
        await db.query(`
            INSERT INTO pickup_forms
              (id, delivery_id, sender_name, sender_phone, sender_address,
               recipient_name, recipient_phone, recipient_address,
               parcel_description, parcel_weight, special_instructions, submitted_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            formId, req.params.deliveryId,
            sender_name, sender_phone, sender_address || null,
            recipient_name, recipient_phone, recipient_address || null,
            parcel_description || null, parcel_weight || null,
            special_instructions || null, req.user.id
        ]);

        // Build summary content for the message
        const summary = JSON.stringify({
            sender_name, sender_phone, sender_address,
            recipient_name, recipient_phone, recipient_address,
            parcel_description, parcel_weight, special_instructions,
            form_id: formId,
        });

        const msgId = generateUUID();
        await db.query(
            `INSERT INTO messages (id, delivery_id, sender_id, recipient_id, content, message_type)
             VALUES (?, ?, ?, ?, ?, 'pickup_form')`,
            [msgId, req.params.deliveryId, req.user.id, d.transporter_id, summary]
        );

        const [newMsg] = await db.query(`
            SELECT m.*, s.name AS sender_name, s.avatar AS sender_avatar, s.role AS sender_role
            FROM messages m JOIN users s ON m.sender_id = s.id WHERE m.id = ?
        `, [msgId]);
        const message = newMsg[0];

        const io = req.app.get('io');
        if (io) io.to(req.params.deliveryId).emit('receive_message', message);

        // DB notification for transporter
        await db.query(
            'INSERT INTO notifications (id, user_id, type, title, body, delivery_id, reference_id) VALUES (UUID(),?,?,?,?,?,?)',
            [d.transporter_id, 'pickup_form_filled',
             '✅ Formulaire rempli',
             'Le client a rempli ses informations de ramassage. Vous pouvez maintenant valider.',
             req.params.deliveryId, msgId]
        );

        // Push notification
        await notifyUsers(db, [d.transporter_id],
            '✅ Formulaire rempli',
            'Le client a rempli ses informations. Validez pour générer le reçu.',
            { screen: 'Chat', deliveryId: req.params.deliveryId }
        );

        res.status(201).json(message);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        console.error('POST /messages/:id/pickup-form Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/messages/:deliveryId/generate-receipt
// Transporter validates the pickup form and generates a receipt.
// Creates QR code image + PDF → uploads both to S3.
// Sends a receipt message card to both parties.
// ─────────────────────────────────────────────────────────────────────
router.post('/:deliveryId/generate-receipt', authenticate, authorizeRoles('transporter'), async (req, res) => {
    try {
        const d = await assertDeliveryAccess(req.params.deliveryId, req.user.id, req.user.role);

        if (!d.transporter_id || d.transporter_id !== req.user.id) {
            return res.status(403).json({ error: 'Vous devez être le transporteur assigné' });
        }

        // Check if restricted
        const [profiles] = await db.query('SELECT messaging_disabled FROM transporter_profiles WHERE user_id = ?', [req.user.id]);
        if (profiles[0]?.messaging_disabled) {
            return res.status(403).json({ error: 'Accès restreint', details: 'Accès désactivé par l\'administrateur' });
        }

        // Check no receipt already generated
        const [existingReceipt] = await db.query(
            'SELECT id FROM receipts WHERE delivery_id = ? LIMIT 1',
            [req.params.deliveryId]
        );
        if (existingReceipt.length > 0) {
            return res.status(409).json({ error: 'Un reçu a déjà été généré pour cette livraison' });
        }

        // Load pickup form (Optional fallback)
        const [forms] = await db.query(
            'SELECT * FROM pickup_forms WHERE delivery_id = ? ORDER BY created_at DESC LIMIT 1',
            [req.params.deliveryId]
        );
        const form = forms.length > 0 ? forms[0] : {};

        // Load full delivery + users
        const [[delivery]] = await db.query(`
            SELECT d.*, v.from_city, v.to_city, v.departure_date, v.price_per_kg,
                   c.name AS client_name, c.phone AS client_phone,
                   t.name AS transporter_name, t.phone AS transporter_phone
            FROM deliveries d
            LEFT JOIN voyages v ON v.id = d.voyage_id
            LEFT JOIN users c ON c.id = d.client_id
            LEFT JOIN users t ON t.id = d.transporter_id
            WHERE d.id = ?
        `, [req.params.deliveryId]);

        // Generate receipt number: TRP-YYYY-XXXXX
        const year = new Date().getFullYear();
        const random = String(Math.floor(10000 + Math.random() * 90000));
        const receiptNumber = `TRP-${year}-${random}`;

        // Build structured QR data
        const qrData = {
            receipt_number: receiptNumber,
            transporter: { name: delivery.transporter_name, phone: delivery.transporter_phone },
            client: { name: delivery.client_name, phone: delivery.client_phone },
            voyage: {
                from: delivery.origin || delivery.from_city,
                to: delivery.destination || delivery.to_city,
                date: delivery.departure_date,
                price_per_kg: delivery.price_per_kg,
            },
            parcel: {
                description: form.parcel_description || delivery.description,
                weight: form.parcel_weight || delivery.weight,
                special_instructions: form.special_instructions,
            },
            sender: { 
                name: form.sender_name || delivery.client_name, 
                phone: form.sender_phone || delivery.client_phone, 
                address: form.sender_address || delivery.pickup_address 
            },
            recipient: { 
                name: form.recipient_name || 'Client', 
                phone: form.recipient_phone || '', 
                address: form.recipient_address || delivery.destination 
            },
            generated_at: new Date().toISOString(),
        };

        const qrString = JSON.stringify(qrData);
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;

        // ── Generate QR code PNG ──
        const qrPngBuffer = await QRCode.toBuffer(qrString, { type: 'png', width: 250, margin: 2 });
        const qrKey = `receipts/qr_${uniqueSuffix}.png`;
        const qrImageUrl = await uploadBufferToS3(qrPngBuffer, qrKey, 'image/png');

        // ── Generate PDF with puppeteer ──
        const row = (label, value) =>
            `<tr><td class="lbl">${label}</td><td>${value || '—'}</td></tr>`;

        const htmlContent = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; padding: 40px; color: #1a1a2e; }
  h1 { color: #1E40AF; text-align: center; font-size: 22px; margin-bottom: 4px; }
  .subtitle { text-align: center; color: #64748b; font-size: 13px; margin-bottom: 24px; }
  .receipt-no { text-align: center; font-size: 18px; font-weight: bold; color: #0f172a; margin-bottom: 20px; }
  .qr-wrap { text-align: center; margin: 20px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
  th { background: #1E40AF; color: white; padding: 10px 12px; text-align: left; }
  td { padding: 9px 12px; border-bottom: 1px solid #e2e8f0; }
  .lbl { background: #f8fafc; font-weight: bold; width: 40%; color: #374151; }
  .section { font-size: 13px; font-weight: bold; background: #eff6ff; color: #1e40af; padding: 10px 12px; margin-top: 16px; }
  .footer { text-align: center; font-size: 11px; color: #94a3b8; margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 16px; }
</style></head><body>
<h1>🧾 REÇU DE TRANSPORT</h1>
<div class="subtitle">Rm Tawssil — Plateforme de transport collaboratif</div>
<div class="receipt-no">${receiptNumber}</div>
<div class="qr-wrap"><img src="${qrImageUrl}" width="160" height="160" /></div>

<table>
  <tr><th colspan="2">🚚 Transporteur</th></tr>
  ${row('Nom', delivery.transporter_name)}
  ${row('Téléphone', delivery.transporter_phone)}
  ${row('Trajet', `${delivery.origin || delivery.from_city} → ${delivery.destination || delivery.to_city}`)}
  ${delivery.price_per_kg ? row('Prix/kg', `${delivery.price_per_kg} MAD`) : ''}

  <tr><th colspan="2">👤 Client</th></tr>
  ${row('Nom', delivery.client_name)}
  ${row('Téléphone', delivery.client_phone)}

  <tr><th colspan="2">📦 Expéditeur</th></tr>
  ${row('Nom', form.sender_name || delivery.client_name)}
  ${row('Téléphone', form.sender_phone || delivery.client_phone)}
  ${row('Adresse', form.sender_address || delivery.pickup_address)}

  <tr><th colspan="2">📍 Destinataire</th></tr>
  ${row('Nom', form.recipient_name || 'Client')}
  ${row('Téléphone', form.recipient_phone || '')}
  ${row('Adresse', form.recipient_address || delivery.destination)}

  <tr><th colspan="2">📋 Colis</th></tr>
  ${row('Description', form.parcel_description || delivery.description)}
  ${row('Poids', (form.parcel_weight || delivery.weight) ? `${form.parcel_weight || delivery.weight} kg` : null)}
  ${row('Instructions spéciales', form.special_instructions)}
</table>

<div class="footer">
  Généré automatiquement par Rm Tawssil le ${new Date().toLocaleString('fr-FR')}.<br/>
  Ce document fait foi de la prise en charge du colis.
</div>
</body></html>`;

        // Launch puppeteer
        const browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
        });
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
        await browser.close();

        const pdfKey = `receipts/pdf_${uniqueSuffix}.pdf`;
        const pdfUrl = await uploadBufferToS3(pdfBuffer, pdfKey, 'application/pdf');

        // ── Save receipt to DB ──
        const receiptId = generateUUID();
        await db.query(`
            INSERT INTO receipts (id, delivery_id, receipt_number, transporter_id, client_id, qr_data, qr_image_url, pdf_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [receiptId, req.params.deliveryId, receiptNumber, req.user.id, d.client_id,
            qrString, qrImageUrl, pdfUrl]);

        // ── Send receipt message to BOTH parties ──
        const receiptPayload = JSON.stringify({
            receipt_number: receiptNumber,
            qr_image_url: qrImageUrl,
            pdf_url: pdfUrl,
            receipt_id: receiptId,
            summary: {
                from: delivery.origin || delivery.from_city,
                to: delivery.destination || delivery.to_city,
                parcel_weight: form.parcel_weight,
                client_name: delivery.client_name,
                transporter_name: delivery.transporter_name,
            },
        });

        // Message to client
        const msgToClient = generateUUID();
        await db.query(
            `INSERT INTO messages (id, delivery_id, sender_id, recipient_id, content, message_type)
             VALUES (?, ?, ?, ?, ?, 'receipt')`,
            [msgToClient, req.params.deliveryId, req.user.id, d.client_id, receiptPayload]
        );

        // Message to transporter (self — so they also see the card)
        const msgToTransporter = generateUUID();
        await db.query(
            `INSERT INTO messages (id, delivery_id, sender_id, recipient_id, content, message_type)
             VALUES (?, ?, ?, ?, ?, 'receipt')`,
            [msgToTransporter, req.params.deliveryId, d.client_id, req.user.id, receiptPayload]
        );

        // Fetch & emit the client-side message
        const [newMsg] = await db.query(`
            SELECT m.*, s.name AS sender_name, s.avatar AS sender_avatar, s.role AS sender_role
            FROM messages m JOIN users s ON m.sender_id = s.id WHERE m.id = ?
        `, [msgToClient]);
        const message = newMsg[0];

        const io = req.app.get('io');
        if (io) io.to(req.params.deliveryId).emit('receive_message', message);

        // DB notifications
        await db.query(
            'INSERT INTO notifications (id,user_id,type,title,body,delivery_id,reference_id) VALUES (UUID(),?,?,?,?,?,?)',
            [d.client_id, 'receipt_generated', '🧾 Reçu disponible',
             `Votre reçu ${receiptNumber} est prêt. Téléchargez-le depuis le chat.`,
             req.params.deliveryId, receiptId]
        );
        await db.query(
            'INSERT INTO notifications (id,user_id,type,title,body,delivery_id,reference_id) VALUES (UUID(),?,?,?,?,?,?)',
            [req.user.id, 'receipt_generated', '🧾 Reçu généré',
             `Le reçu ${receiptNumber} a été généré avec succès.`,
             req.params.deliveryId, receiptId]
        );

        // Push notifications
        await notifyUsers(db, [d.client_id, req.user.id],
            '🧾 Reçu disponible',
            `Le reçu ${receiptNumber} est disponible dans le chat.`,
            { screen: 'Chat', deliveryId: req.params.deliveryId }
        );

        res.status(201).json({
            receipt_number: receiptNumber,
            receipt_id: receiptId,
            qr_image_url: qrImageUrl,
            pdf_url: pdfUrl,
        });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        console.error('POST /messages/:id/generate-receipt Error:', err);
        res.status(500).json({ error: 'Erreur lors de la génération du reçu', details: err.message });
    }
});

module.exports = router;
