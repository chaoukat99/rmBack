const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const { generateUUID } = require('../utils/uuid');
const {
    createDeliverySchema, updateDeliveryStatusSchema,
    updatePickupStatusSchema, ratingSchema, updateLocationSchema,
    clientRequestPickupSchema, approveTransporterSchema, createTrajectorySchema
} = require('../utils/validations');

// Generates a unique tracking code (Format: RT-YYYY-XXX-YYY-NUM)
const generateTrackingCode = () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const prefix = 'RT-' + new Date().getFullYear();
    const randomChars = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${randomChars}-${randomNum}`;
};


// 1. GET /api/deliveries - List deliveries based on user role
router.get('/', authenticate, async (req, res) => {
    try {
        let sql = `
            SELECT d.*, c.name as clientName, t.name as transporterName,
                   (SELECT content FROM messages WHERE delivery_id = d.id ORDER BY created_at DESC LIMIT 1) as lastMessage,
                   (SELECT created_at FROM messages WHERE delivery_id = d.id ORDER BY created_at DESC LIMIT 1) as lastMessageAt,
                   (SELECT COUNT(*) FROM messages WHERE delivery_id = d.id AND recipient_id = ? AND is_read = FALSE) as unreadCount
            FROM deliveries d
            LEFT JOIN users c ON d.client_id = c.id
            LEFT JOIN users t ON d.transporter_id = t.id
        `;
        const params = [req.user.id];

        if (req.user.role === 'client') {
            sql += ' WHERE d.client_id = ?';
            params.push(req.user.id);
        } else if (req.user.role === 'admin' || req.user.role === 'support') {
            // Admin and Support see all - no extra where needed
        } else if (req.user.role === 'transporter') {
            // Simplified query as requested
            sql = `
                SELECT 
                    d.*, 
                    c.name as clientName, 
                    t.name as transporterName,
                    EXISTS (
                        SELECT 1 FROM transporter_trajectories tt 
                        WHERE tt.transporter_id = ? 
                          AND tt.status = 'approved' 
                          AND (
                            (d.origin LIKE CONCAT('%', tt.from_city, '%') AND d.destination LIKE CONCAT('%', tt.to_city, '%'))
                            OR
                            (d.origin LIKE CONCAT('%', tt.to_city, '%') AND d.destination LIKE CONCAT('%', tt.from_city, '%'))
                          )
                    ) as isMatch
                FROM deliveries d
                LEFT JOIN users c ON d.client_id = c.id
                LEFT JOIN users t ON d.transporter_id = t.id
                WHERE d.transporter_id = ? 
                   OR d.status = 'Pending'
            `;
            params.length = 0;
            params.push(req.user.id, req.user.id);
        }

        sql += ' ORDER BY d.created_at DESC';

        const [deliveries] = await db.query(sql, params);
        res.json(deliveries);

    } catch (err) {
        console.error('Fetch Deliveries Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// 2. GET /api/deliveries/:id - Get specific delivery details
router.get('/:id', authenticate, async (req, res) => {
    try {
        const [deliveries] = await db.query(
            `SELECT d.*, c.name as clientName, t.name as transporterName 
         FROM deliveries d
         LEFT JOIN users c ON d.client_id = c.id
         LEFT JOIN users t ON d.transporter_id = t.id
         WHERE d.id = ?`,
            [req.params.id]
        );

        if (deliveries.length === 0) return res.status(404).json({ error: 'Delivery not found' });

        const delivery = deliveries[0];

        // Authorization check
        if (req.user.role !== 'admin' && req.user.role !== 'support') {
            if (req.user.role === 'client' && delivery.client_id !== req.user.id) {
                return res.status(403).json({ error: 'Access denied' });
            }
            if (req.user.role === 'transporter' && delivery.transporter_id && delivery.transporter_id !== req.user.id) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        res.json(delivery);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// 3. POST /api/deliveries - Create a new delivery (Clients only)
// 3b. POST /api/deliveries/init-chat - Initialize a discussion (Client <-> Transporter)
router.post('/init-chat', authenticate, authorizeRoles('client', 'transporter'), async (req, res) => {
    let { transporter_id, client_id, voyage_id, origin, destination } = req.body;

    // If client is calling, transporter_id is required. 
    // If transporter is calling, client_id is required.
    if (req.user.role === 'client') transporter_id = transporter_id || req.body.transporter_id;
    if (req.user.role === 'transporter') client_id = client_id || req.body.client_id;
    
    const otherPartyId = req.user.role === 'client' ? transporter_id : client_id;

    if (!otherPartyId) {
        return res.status(400).json({ error: 'ID de l\'autre partie requis' });
    }

    try {
        // 1. Check if a pending discussion already exists between these two
        let sql = 'SELECT id FROM deliveries WHERE client_id = ? AND transporter_id = ? AND status = "Pending"';
        const params = [
            req.user.role === 'client' ? req.user.id : client_id,
            req.user.role === 'transporter' ? req.user.id : transporter_id
        ];
        
        // Match specific voyage if provided
        if (voyage_id) {
            sql += ' AND voyage_id = ?';
            params.push(voyage_id);
        }

        const [existing] = await db.query(sql, params);

        if (existing.length > 0) {
            return res.json({ id: existing[0].id, isNew: false });
        }

        // 2. Specialized logic for Transporter starting chat on a generic "Pending" delivery (where transporter_id was NULL)
        if (req.user.role === 'transporter') {
             const [generic] = await db.query(
                 'SELECT id FROM deliveries WHERE client_id = ? AND transporter_id IS NULL AND status = "Pending" AND origin = ? AND destination = ?',
                 [client_id, origin, destination]
             );
             if (generic.length > 0) {
                 await db.query('UPDATE deliveries SET transporter_id = ?, voyage_id = ? WHERE id = ?', [req.user.id, voyage_id || null, generic[0].id]);
                 return res.json({ id: generic[0].id, isNew: false });
             }
        }

        // 3. Create a new discussion record if none exists
        const deliveryId = generateUUID();
        const trackingCode = generateTrackingCode();

        await db.query(`
            INSERT INTO deliveries (
                id, client_id, transporter_id, voyage_id, tracking_code, 
                origin, destination, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, "Pending")
        `, [
            deliveryId, 
            req.user.role === 'client' ? req.user.id : client_id,
            req.user.role === 'transporter' ? req.user.id : transporter_id,
            voyage_id || null, 
            trackingCode, origin || null, destination || null
        ]);

        res.status(201).json({ id: deliveryId, isNew: true });

        // 3. Add an initial system message to start the thread
        await db.query(`
            INSERT INTO messages (id, delivery_id, sender_id, recipient_id, content, message_type)
            VALUES (?, ?, ?, ?, ?, 'system')
        `, [
            generateUUID(), deliveryId, req.user.id, transporter_id, 
            "Discussion initialisée. Le client est intéressé.", 'system'
        ]);

        res.status(201).json({ id: deliveryId, isNew: true });

    } catch (err) {
        console.error('init-chat Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


router.post('/', authenticate, authorizeRoles('client'), async (req, res) => {
    console.log('--- NEW DELIVERY REQUEST ---');
    console.log('User ID:', req.user.id);
    console.log('Payload:', JSON.stringify(req.body, null, 2));

    const validationResult = createDeliverySchema.safeParse(req.body);
    if (!validationResult.success) {
        console.warn('❌ Validation Failed:', JSON.stringify(validationResult.error.format(), null, 2));
        return res.status(400).json({ error: 'Validation failed', details: validationResult.error.errors });
    }

    console.log('✅ Validation Success');

    const {
        origin, destination, pickup_address, pickup_phone,
        package_type, weight, dimensions, description, declared_value,
        is_urgent, is_insured, request_date, transporter_id, voyage_id
    } = req.body;

    try {
        let finalOrigin = origin;
        let finalDestination = destination;
        let finalTransporterId = transporter_id;

        // If voyage_id is provided, we can fetch most details from it
        if (voyage_id) {
            const [voyages] = await db.query('SELECT * FROM voyages WHERE id = ?', [voyage_id]);
            if (voyages.length > 0) {
                const v = voyages[0];
                finalOrigin = finalOrigin || v.from_city;
                finalDestination = finalDestination || v.to_city;
                finalTransporterId = finalTransporterId || v.transporter_id;
            }
        }

        const deliveryId = generateUUID();
        const trackingCode = generateTrackingCode();

        await db.query(`
            INSERT INTO deliveries (
                id, client_id, tracking_code, origin, destination, 
                pickup_address, pickup_phone, package_type, weight, 
                dimensions, description, declared_value, is_urgent, 
                is_insured, request_date, transporter_id, voyage_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            deliveryId, req.user.id, trackingCode, finalOrigin || null, finalDestination || null,
            pickup_address || null, pickup_phone || null, package_type || null, weight || null,
            dimensions || null, description || null, declared_value || null, is_urgent || false,
            is_insured || false, request_date || null, finalTransporterId || null, voyage_id || null
        ]);

        // If it's a quick chat start, add a system message
        if (voyage_id && finalTransporterId) {
            await db.query(`
                INSERT INTO messages (id, delivery_id, sender_id, recipient_id, content)
                VALUES (?, ?, ?, ?, ?)
            `, [generateUUID(), deliveryId, req.user.id, finalTransporterId, "Bonjour, je suis intéressé par votre voyage. Pouvons-nous discuter des détails ?"]);
        }

        res.status(201).json({
            message: 'Delivery request created successfully',
            id: deliveryId,
            trackingCode
        });
    } catch (err) {
        console.error('❌ Database Error while creating delivery:', err);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
});


// 4. PATCH /api/deliveries/:id/status - Update delivery status (Transporter/Admin/Support)
router.patch('/:id/status', authenticate, authorizeRoles('transporter', 'admin', 'support'), async (req, res) => {
    const validationResult = updateDeliveryStatusSchema.safeParse(req.body);
    if (!validationResult.success) {
        return res.status(400).json({ error: 'Validation failed', details: validationResult.error.errors });
    }

    try {
        // Basic check
        const [deliveries] = await db.query('SELECT origin, destination, transporter_id FROM deliveries WHERE id = ?', [req.params.id]);
        if (deliveries.length === 0) return res.status(404).json({ error: 'Delivery not found' });

        const d = discoveries = deliveries[0];

        // Assign transporter if they accept it
        if (req.body.status === 'Accepted' && !d.transporter_id) {
            // 1. Subscription check
            const [profiles] = await db.query('SELECT subscription_status, subscription_expires_at FROM transporter_profiles WHERE user_id = ?', [req.user.id]);
            const profile = profiles[0];
            
            const isSubscribed = profile && profile.subscription_status === 'active' && 
                               (!profile.subscription_expires_at || new Date(profile.subscription_expires_at) > new Date());

            if (!isSubscribed) {
                const [msgCounts] = await db.query(
                    'SELECT COUNT(DISTINCT delivery_id) AS conversation_count FROM messages WHERE sender_id = ?',
                    [req.user.id]
                );
                if ((msgCounts[0].conversation_count || 0) >= 3) {
                    return res.status(403).json({ 
                        error: 'Limite de conversations atteinte', 
                        details: 'Vous avez atteint la limite de 3 conversations/offres gratuites. Veuillez activer votre abonnement Premium.' 
                    });
                }
            }

            // 2. Trajectory match check (bidirectional: A→B or B→A)
            const [matches] = await db.query(`
                SELECT 1 FROM transporter_trajectories tt 
                WHERE tt.transporter_id = ? 
                  AND tt.status = 'approved' 
                  AND (
                    (? LIKE CONCAT('%', tt.from_city, '%') AND ? LIKE CONCAT('%', tt.to_city, '%'))
                    OR
                    (? LIKE CONCAT('%', tt.to_city, '%') AND ? LIKE CONCAT('%', tt.from_city, '%'))
                  )
            `, [req.user.id, d.origin, d.destination, d.origin, d.destination]);

            if (matches.length === 0) {
                return res.status(400).json({ error: "Vous ne pouvez accepter que les livraisons qui correspondent à vos trajets approuvés." });
            }

            // Update delivery
            await db.query('UPDATE deliveries SET status = ?, transporter_id = ? WHERE id = ?', [req.body.status, req.user.id, req.params.id]);

            // AUTO-MESSAGE to client
            const [clientInfo] = await db.query('SELECT client_id, origin, destination FROM deliveries WHERE id = ?', [req.params.id]);
            if (clientInfo.length > 0) {
                const messageId = generateUUID();
                const welcomeMsg = `Bonjour ! J'ai accepté votre demande de livraison de ${clientInfo[0].origin} vers ${clientInfo[0].destination}. Discutons des détails du ramassage.`;
                
                await db.query(`
                    INSERT INTO messages (id, delivery_id, sender_id, recipient_id, content, message_type)
                    VALUES (?, ?, ?, ?, ?, 'pickup_accepted')
                `, [messageId, req.params.id, req.user.id, clientInfo[0].client_id, welcomeMsg]);
            }
        } else {
            // If already assigned, ensure only the assigned transporter updates it
            const [current] = await db.query('SELECT transporter_id, client_id FROM deliveries WHERE id = ?', [req.params.id]);
            if (req.user.role === 'transporter' && current[0].transporter_id !== req.user.id) {
                return res.status(403).json({ error: 'Access denied' });
            }
            if (req.body.status === 'Pending') {
                await db.query('UPDATE deliveries SET status = "Pending", transporter_id = NULL, pickup_status = "pending" WHERE id = ?', [req.params.id]);
                
                const messageId = generateUUID();
                const cancelMsg = req.user.role === 'transporter' 
                    ? `Le transporteur a annulé sa participation. Votre demande est à nouveau disponible.`
                    : `Le client a annulé la discussion. La demande est redevenue disponible.`;
                const systemRecipient = req.user.role === 'transporter' ? current[0].client_id : current[0].transporter_id;

                if (systemRecipient) {
                     await db.query(`
                        INSERT INTO messages (id, delivery_id, sender_id, recipient_id, content, message_type)
                        VALUES (?, ?, ?, ?, ?, 'system')
                     `, [messageId, req.params.id, req.user.id, systemRecipient, cancelMsg]);
                }
            } else {
                await db.query('UPDATE deliveries SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
            }
        }

        // Record notification logic can be triggered here

        res.json({ message: 'Delivery status updated', status: req.body.status });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// 5. PATCH /api/deliveries/:id/pickup - Update pickup status (Both parties)
router.patch('/:id/pickup', authenticate, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT client_id, transporter_id, status, pickup_status FROM deliveries WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Livraison introuvable' });
        const d = rows[0];

        const { pickup_status, status } = req.body;

        // Client can only set to 'requested'
        if (req.user.role === 'client') {
            if (d.client_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });
            
            // Client filling info from Chat (Demander ramassage)
            if (pickup_status === 'requested') {
                const result = clientRequestPickupSchema.safeParse(req.body);
                if (!result.success) return res.status(400).json({ error: 'Données de ramassage invalides', details: result.error.errors });
                
                const { pickup_address, pickup_phone, package_type, weight, request_date } = result.data;
                await db.query(`
                    UPDATE deliveries 
                    SET pickup_address = ?, pickup_phone = ?, package_type = ?, weight = ?, request_date = ?, pickup_status = 'requested'
                    WHERE id = ?
                `, [pickup_address, pickup_phone, package_type, weight, request_date || null, req.params.id]);

                // Create system message
                await db.query('INSERT INTO messages (id, delivery_id, sender_id, recipient_id, content) VALUES (?, ?, ?, ?, ?)',
                    [generateUUID(), req.params.id, req.user.id, d.transporter_id, `🟢 STATUS: ${req.user.name} a demandé un ramassage.`]);
                
                return res.json({ message: 'Demande de ramassage envoyée', pickup_status: 'requested' });
            }
        }

        // Transporter permissions
        if (req.user.role === 'transporter') {
            if (d.transporter_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });

            if (pickup_status === 'accepted') {
                await db.query('UPDATE deliveries SET pickup_status = "accepted", status = "Accepted" WHERE id = ?', [req.params.id]);
                await db.query('INSERT INTO messages (id, delivery_id, sender_id, recipient_id, content) VALUES (?, ?, ?, ?, ?)',
                    [generateUUID(), req.params.id, req.user.id, d.client_id, `🟢 STATUS: ${req.user.name} a accepté le ramassage.`]);
                return res.json({ message: 'Ramassage accepté', pickup_status: 'accepted' });
            }

            if (pickup_status === 'completed') {
                await db.query('UPDATE deliveries SET pickup_status = "completed", status = "In Transit", pickup_date = CURRENT_DATE() WHERE id = ?', [req.params.id]);
                await db.query('INSERT INTO messages (id, delivery_id, sender_id, recipient_id, content) VALUES (?, ?, ?, ?, ?)',
                    [generateUUID(), req.params.id, req.user.id, d.client_id, `🟢 STATUS: Colis récupéré. Voyage en cours.`]);
                return res.json({ message: 'Ramassage terminé. Colis en transit.', pickup_status: 'completed' });
            }
            
            if (status === 'Delivered') {
                await db.query('UPDATE deliveries SET status = "Delivered", delivery_date = CURRENT_DATE() WHERE id = ?', [req.params.id]);
                await db.query('INSERT INTO messages (id, delivery_id, sender_id, recipient_id, content) VALUES (?, ?, ?, ?, ?)',
                    [generateUUID(), req.params.id, req.user.id, d.client_id, `🟢 STATUS: Colis livré avec succès.`]);
                return res.json({ message: 'Livraison confirmée', status: 'Delivered' });
            }
        }

        return res.status(400).json({ error: 'Action non autorisée ou état invalide' });
    } catch (err) {
        console.error('PATCH /pickup Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// 6. POST /api/deliveries/:id/rate - Client rates a delivered shipment
router.post('/:id/rate', authenticate, authorizeRoles('client'), async (req, res) => {
    // Merge delivery id from params into body for validation
    const parseBody = { ...req.body, delivery_id: req.params.id };
    const result = ratingSchema.safeParse(parseBody);
    if (!result.success) {
        return res.status(400).json({ error: 'Validation failed', details: result.error.errors });
    }

    const { stars, comment } = result.data;

    try {
        // Verify delivery exists, belongs to client, is delivered, and not already rated
        const [deliveries] = await db.query(
            'SELECT id, transporter_id, status FROM deliveries WHERE id = ? AND client_id = ?',
            [req.params.id, req.user.id]
        );

        if (deliveries.length === 0) {
            return res.status(404).json({ error: 'Livraison introuvable' });
        }

        const delivery = deliveries[0];

        if (delivery.status !== 'Delivered') {
            return res.status(400).json({ error: 'Vous ne pouvez noter que les livraisons terminées' });
        }

        if (!delivery.transporter_id) {
            return res.status(400).json({ error: 'Aucun transporteur assigné à cette livraison' });
        }

        // Check if already rated
        const [existing] = await db.query(
            'SELECT id FROM ratings WHERE delivery_id = ?',
            [req.params.id]
        );
        if (existing.length > 0) {
            return res.status(409).json({ error: 'Cette livraison a déjà été notée' });
        }

        // Insert rating
        const ratingId = generateUUID();
        await db.query(
            'INSERT INTO ratings (id, delivery_id, client_id, transporter_id, stars, comment) VALUES (?, ?, ?, ?, ?, ?)',
            [ratingId, req.params.id, req.user.id, delivery.transporter_id, stars, comment || null]
        );

        // Recalculate and update transporter average rating
        const [[avgRow]] = await db.query(
            'SELECT AVG(stars) AS avg_rating, COUNT(*) AS total FROM ratings WHERE transporter_id = ?',
            [delivery.transporter_id]
        );

        await db.query(
            'UPDATE transporter_profiles SET rating = ?, total_deliveries = ? WHERE user_id = ?',
            [parseFloat(avgRow.avg_rating).toFixed(2), avgRow.total, delivery.transporter_id]
        );

        // Notify transporter of new rating
        await db.query(
            'INSERT INTO notifications (id, user_id, type, title, body, delivery_id) VALUES (?, ?, ?, ?, ?, ?)',
            [
                generateUUID(),
                delivery.transporter_id,
                'new_rating',
                `⭐ Nouvelle évaluation: ${stars}/5`,
                comment ? `"${comment}"` : 'Vous avez reçu une nouvelle évaluation.',
                req.params.id,
            ]
        );

        res.status(201).json({
            message: 'Merci pour votre évaluation!',
            rating_id: ratingId,
            new_avg_rating: parseFloat(avgRow.avg_rating).toFixed(2),
        });
    } catch (err) {
        console.error('POST /deliveries/:id/rate Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// 7. GET /api/deliveries/tracking/:code - Track by code (no auth needed)
router.get('/tracking/:code', async (req, res) => {
    try {
        const [deliveries] = await db.query(`
            SELECT d.tracking_code, d.origin, d.destination, d.status, d.pickup_status,
                   d.request_date, d.pickup_date, d.delivery_date,
                   d.package_type, d.weight, d.is_urgent,
                   u.name AS transporter_name, u.phone AS transporter_phone
            FROM   deliveries d
            LEFT   JOIN users u ON d.transporter_id = u.id
            WHERE  d.tracking_code = ?
        `, [req.params.code]);

        if (deliveries.length === 0) {
            return res.status(404).json({ error: 'Code de suivi introuvable' });
        }

        res.json(deliveries[0]);
    } catch (err) {
        console.error('GET /deliveries/tracking/:code Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// 8. DELETE /api/deliveries/:id - Delete a delivery request (Clients only, if Pending)
router.delete('/:id', authenticate, authorizeRoles('client'), async (req, res) => {
    try {
        const [deliveries] = await db.query(
            'SELECT client_id, status FROM deliveries WHERE id = ?',
            [req.params.id]
        );

        if (deliveries.length === 0) {
            return res.status(404).json({ error: 'Livraison introuvable' });
        }

        const delivery = deliveries[0];

        // Ensure it belongs to the client
        if (delivery.client_id !== req.user.id) {
            return res.status(403).json({ error: 'Accès refusé' });
        }

        // Only allow deletion if it's still Pending
        if (delivery.status !== 'Pending') {
            return res.status(400).json({ error: 'Vous ne pouvez supprimer que les demandes en attente' });
        }

        await db.query('DELETE FROM deliveries WHERE id = ?', [req.params.id]);

        res.json({ message: 'Demande supprimée avec succès' });
    } catch (err) {
        console.error('DELETE /deliveries/:id Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// 9. PATCH /api/deliveries/:id/location - Update transporter location
router.patch('/:id/location', authenticate, authorizeRoles('transporter'), async (req, res) => {
    const validationResult = updateLocationSchema.safeParse(req.body);
    if (!validationResult.success) {
        return res.status(400).json({ error: 'Validation failed', details: validationResult.error.errors });
    }

    const { latitude, longitude } = req.body;

    try {
        const [deliveries] = await db.query('SELECT transporter_id, status FROM deliveries WHERE id = ?', [req.params.id]);
        if (deliveries.length === 0) return res.status(404).json({ error: 'Delivery not found' });

        if (deliveries[0].transporter_id !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // We only track location if it's In Transit (optional but logical)
        // if (deliveries[0].status !== 'In Transit') {
        //     return res.status(400).json({ error: 'Tracking only available for shipments In Transit' });
        // }

        await db.query('UPDATE deliveries SET current_lat = ?, current_lng = ? WHERE id = ?',
            [latitude, longitude, req.params.id]
        );

        res.json({ message: 'Location updated', lat: latitude, lng: longitude });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});



// 10. PATCH /api/deliveries/:id/quit-voyage — Client cancels their voyage reservation
router.patch('/:id/quit-voyage', authenticate, authorizeRoles('client'), async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT client_id, transporter_id, voyage_id, status FROM deliveries WHERE id = ?',
            [req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Livraison introuvable' });
        const d = rows[0];

        if (d.client_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });
        if (!d.voyage_id) return res.status(400).json({ error: 'Cette livraison n\'est pas liée à un voyage' });
        if (d.status === 'In Transit' || d.status === 'Delivered') {
            return res.status(400).json({ error: 'Impossible de quitter un voyage déjà en transit ou livré' });
        }

        // Reset delivery back to a standalone pending request
        await db.query(
            'UPDATE deliveries SET status = "Pending", transporter_id = NULL, voyage_id = NULL, pickup_status = "pending" WHERE id = ?',
            [req.params.id]
        );

        // Notify the transporter via a system message if one was assigned
        if (d.transporter_id) {
            await db.query(
                'INSERT INTO messages (id, delivery_id, sender_id, recipient_id, content, message_type) VALUES (?, ?, ?, ?, ?, ?)',
                [generateUUID(), req.params.id, req.user.id, d.transporter_id,
                 '🚫 Le client a annulé sa réservation sur votre voyage. La demande est redevenue disponible.',
                 'system']
            );
        }

        res.json({ message: 'Réservation annulée avec succès. Votre demande est à nouveau disponible.' });
    } catch (err) {
        console.error('PATCH /deliveries/:id/quit-voyage Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


module.exports = router;
