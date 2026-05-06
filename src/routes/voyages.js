const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const { generateUUID } = require('../utils/uuid');
const { createVoyageSchema, updateVoyageStatusSchema } = require('../utils/validations');
const { notifyUsers } = require('../utils/pushNotifications');


// ─────────────────────────────────────────────────────────────────────
// GET /api/voyages
// List voyages
//  - Transporter: sees only their own voyages
//  - Client/Admin: sees all voyages (for searching available transporters)
// ─────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
    try {
        let sql = `
            SELECT v.*, u.name AS transporter_name, u.phone AS transporter_phone,
                   u.avatar AS transporter_avatar,
                   tp.rating, tp.vehicle, tp.verified,
                   (SELECT COUNT(*) FROM deliveries WHERE voyage_id = v.id AND status = 'Accepted') as confirmed_clients
            FROM   voyages v
            JOIN   users u  ON v.transporter_id = u.id
            JOIN   transporter_profiles tp ON tp.user_id = u.id
        `;
        const params = [];

        if (req.user.role === 'transporter') {
            sql += ' WHERE v.transporter_id = ?';
            params.push(req.user.id);
        } else {
            // For clients searching transporters, filter out cancelled/completed voyages
            if (req.query.status) {
                sql += ' WHERE v.status = ?';
                params.push(req.query.status);
            } else {
                sql += " WHERE v.status IN ('upcoming','in_progress')";
            }
        }

        // Optional route filter
        if (req.query.from_country) {
            sql += params.length ? ' AND' : ' WHERE';
            sql += ' v.from_country = ?';
            params.push(req.query.from_country);
        }
        if (req.query.to_country) {
            sql += ' AND v.to_country = ?';
            params.push(req.query.to_country);
        }

        sql += ' ORDER BY v.departure_date ASC';

        const [voyages] = await db.query(sql, params);
        res.json(voyages);
    } catch (err) {
        console.error('GET /voyages Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/voyages/:id  — Get a single voyage
// ─────────────────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT v.*, u.name AS transporter_name, u.phone AS transporter_phone,
                   u.avatar AS transporter_avatar, tp.rating, tp.vehicle, tp.verified,
                   tp.total_deliveries,
                   (SELECT COUNT(*) FROM deliveries WHERE voyage_id = v.id AND status = 'Accepted') as confirmed_clients
            FROM   voyages v
            JOIN   users u  ON v.transporter_id = u.id
            JOIN   transporter_profiles tp ON tp.user_id = u.id
            WHERE  v.id = ?
        `, [req.params.id]);

        if (rows.length === 0) return res.status(404).json({ error: 'Voyage introuvable' });

        // Transporters can only see their own voyages
        const voyage = rows[0];
        if (req.user.role === 'transporter' && voyage.transporter_id !== req.user.id) {
            return res.status(403).json({ error: 'Accès refusé' });
        }

        res.json(voyage);
    } catch (err) {
        console.error('GET /voyages/:id Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/voyages  — Create a voyage (transporter only)
// ─────────────────────────────────────────────────────────────────────
router.post('/', authenticate, authorizeRoles('transporter'), async (req, res) => {
    const result = createVoyageSchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ error: 'Validation échouée', details: result.error.errors });
    }

    const {
        trajectory_id, from_country, from_city, to_country, to_city,
        departure_date, estimated_arrival, available_capacity, price_per_kg, notes
    } = result.data;

    try {
        const [tp] = await db.query('SELECT user_id, verified FROM transporter_profiles WHERE user_id = ?', [req.user.id]);
        if (tp.length === 0) {
            return res.status(403).json({ error: `Profil transporteur introuvable pour l'ID: ${req.user.id}` });
        }

        let traj;
        if (trajectory_id) {
            // Find specified trajectory
            const [trajectories] = await db.query('SELECT * FROM transporter_trajectories WHERE id = ? AND transporter_id = ?', [trajectory_id, req.user.id]);
            if (trajectories.length === 0) return res.status(400).json({ error: 'Trajet invalide' });
            traj = trajectories[0];
        } else if (from_city && to_city) {
            // Look for existing trajectory matching these cities
            const [existing] = await db.query(
                'SELECT * FROM transporter_trajectories WHERE transporter_id = ? AND from_city = ? AND to_city = ?',
                [req.user.id, from_city, to_city]
            );
            if (existing.length > 0) {
                traj = existing[0];
            } else {
                // Create a new one automatically
                const newTrajId = generateUUID();
                await db.query(`
                    INSERT INTO transporter_trajectories (id, transporter_id, from_country, from_city, to_country, to_city, status)
                    VALUES (?, ?, ?, ?, ?, ?, 'pending')
                `, [newTrajId, req.user.id, from_country || '', from_city, to_country || '', to_city]);
                traj = { id: newTrajId, from_country, from_city, to_country, to_city };
            }
        } else {
            return res.status(400).json({ error: 'ID de trajet ou villes de départ/arrivée requis' });
        }

        const voyageId = generateUUID();
        await db.query(`
            INSERT INTO voyages
              (id, transporter_id, from_country, from_city, to_country, to_city,
               departure_date, estimated_arrival, available_capacity, price_per_kg, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            voyageId, req.user.id, traj.from_country, traj.from_city, traj.to_country, traj.to_city,
            departure_date, estimated_arrival, available_capacity || null, price_per_kg || null, notes || null
        ]);

        // Update next_trip on transporter profile
        await db.query(
            'UPDATE transporter_profiles SET next_trip = ? WHERE user_id = ?',
            [departure_date, req.user.id]
        );

        res.status(201).json({
            message: 'Voyage créé avec succès',
            id: voyageId,
        });
    } catch (err) {
        console.error('POST /voyages Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// PUT /api/voyages/:id  — Update voyage details
// ─────────────────────────────────────────────────────────────────────
router.put('/:id', authenticate, authorizeRoles('transporter'), async (req, res) => {
    const result = createVoyageSchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ error: 'Validation échouée', details: result.error.errors });
    }

    const {
        trajectory_id, from_country, from_city, to_country, to_city,
        departure_date, estimated_arrival, available_capacity, price_per_kg, notes
    } = result.data;

    try {
        const [rows] = await db.query('SELECT transporter_id FROM voyages WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Voyage introuvable' });

        if (rows[0].transporter_id !== req.user.id) {
            return res.status(403).json({ error: 'Accès refusé' });
        }

        let traj;
        if (trajectory_id) {
            const [trajectories] = await db.query('SELECT * FROM transporter_trajectories WHERE id = ? AND transporter_id = ?', [trajectory_id, req.user.id]);
            if (trajectories.length === 0) return res.status(400).json({ error: 'Trajet invalide' });
            traj = trajectories[0];
        } else if (from_city && to_city) {
             const [existing] = await db.query(
                'SELECT * FROM transporter_trajectories WHERE transporter_id = ? AND from_city = ? AND to_city = ?',
                [req.user.id, from_city, to_city]
            );
            if (existing.length > 0) {
                traj = existing[0];
            } else {
                const newTrajId = generateUUID();
                await db.query(`
                    INSERT INTO transporter_trajectories (id, transporter_id, from_country, from_city, to_country, to_city, status)
                    VALUES (?, ?, ?, ?, ?, ?, 'pending')
                `, [newTrajId, req.user.id, from_country || '', from_city, to_country || '', to_city]);
                traj = { id: newTrajId, from_country, from_city, to_country, to_city };
            }
        } else {
             return res.status(400).json({ error: 'ID de trajet ou villes de départ/arrivée requis' });
        }

        await db.query(`
            UPDATE voyages
            SET from_country = ?, from_city = ?, to_country = ?, to_city = ?,
                departure_date = ?, estimated_arrival = ?, available_capacity = ?,
                price_per_kg = ?, notes = ?
            WHERE id = ?
        `, [
            traj.from_country, traj.from_city, traj.to_country, traj.to_city,
            departure_date, estimated_arrival, available_capacity || null,
            price_per_kg || null, notes || null, req.params.id
        ]);

        res.json({ message: 'Voyage mis à jour avec succès' });
    } catch (err) {
        console.error('PUT /voyages/:id Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/voyages/:id/status  — Update voyage status
// ─────────────────────────────────────────────────────────────────────
router.patch('/:id/status', authenticate, authorizeRoles('transporter', 'admin'), async (req, res) => {
    const result = updateVoyageStatusSchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ error: 'Statut invalide', details: result.error.errors });
    }

    try {
        const [rows] = await db.query('SELECT transporter_id FROM voyages WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Voyage introuvable' });

        if (req.user.role === 'transporter' && rows[0].transporter_id !== req.user.id) {
            return res.status(403).json({ error: 'Accès refusé' });
        }

        await db.query('UPDATE voyages SET status = ? WHERE id = ?', [result.data.status, req.params.id]);

        if (result.data.status === 'in_progress') {
            // Mark all accepted deliveries on this voyage as In Transit
            await db.query('UPDATE deliveries SET status = "In Transit" WHERE voyage_id = ? AND status = "Accepted"', [req.params.id]);
        } else if (result.data.status === 'completed') {
            // Mark all active deliveries on this voyage as Delivered
            await db.query('UPDATE deliveries SET status = "Delivered", delivery_date = CURRENT_DATE() WHERE voyage_id = ? AND status IN ("Accepted", "In Transit")', [req.params.id]);
        }

        res.json({ message: 'Statut du voyage mis à jour', status: result.data.status });
    } catch (err) {
        console.error('PATCH /voyages/:id/status Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// DELETE /api/voyages/:id  — Cancel/delete a voyage
// ─────────────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, authorizeRoles('transporter', 'admin'), async (req, res) => {
    try {
        const [rows] = await db.query('SELECT transporter_id, status FROM voyages WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Voyage introuvable' });

        if (req.user.role === 'transporter' && rows[0].transporter_id !== req.user.id) {
            return res.status(403).json({ error: 'Accès refusé' });
        }

        // Cannot delete an in-progress voyage
        if (rows[0].status === 'in_progress') {
            return res.status(400).json({ error: 'Impossible d\'annuler un voyage en cours' });
        }

        // Soft cancel rather than hard delete
        await db.query("UPDATE voyages SET status = 'cancelled' WHERE id = ?", [req.params.id]);

        // Notify all linked applicants (deliveries connected to this voyage)
        const [applicants] = await db.query(
            'SELECT id, client_id FROM deliveries WHERE voyage_id = ? AND status NOT IN ("Delivered", "Cancelled")',
            [req.params.id]
        );

        if (applicants.length > 0) {
            const clientIds = [...new Set(applicants.map(a => a.client_id))];

            // In-app DB notifications
            for (const clientId of clientIds) {
                await db.query(
                    'INSERT INTO notifications (id, user_id, type, title, body, reference_id) VALUES (UUID(), ?, ?, ?, ?, ?)',
                    [clientId, 'voyage_cancelled',
                     '🚫 Voyage annulé',
                     'Le transporteur a annulé le voyage auquel vous êtiez inscrit. Votre demande est à nouveau disponible.',
                     req.params.id]
                );
            }

            // System messages in each delivery chat
            for (const applicant of applicants) {
                await db.query(
                    'INSERT INTO messages (id, delivery_id, sender_id, recipient_id, content, message_type) VALUES (?, ?, ?, ?, ?, ?)',
                    [generateUUID(), applicant.id,
                     rows[0].transporter_id, applicant.client_id,
                     '🚫 Le transporteur a annulé ce voyage. Votre demande est à nouveau disponible.',
                     'system']
                );
                // Reset delivery to free it up
                await db.query(
                    'UPDATE deliveries SET status = "Pending", transporter_id = NULL, voyage_id = NULL, pickup_status = "pending" WHERE id = ?',
                    [applicant.id]
                );
            }

            // Push notifications to all affected clients
            await notifyUsers(db, clientIds,
                '🚫 Voyage annulé',
                'Le transporteur a annulé le voyage. Votre demande est à nouveau disponible.',
                { screen: 'MyDeliveries' }
            );
        }

        res.json({ message: 'Voyage annulé avec succès', notified_clients: applicants.length });
    } catch (err) {
        console.error('DELETE /voyages/:id Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});


// ─────────────────────────────────────────────────────────────────────
// DELETE /api/voyages/:id/clients/:deliveryId
// Transporter removes a specific client from their voyage
// ─────────────────────────────────────────────────────────────────────
router.delete('/:id/clients/:deliveryId', authenticate, authorizeRoles('transporter'), async (req, res) => {
    const { id: voyageId, deliveryId } = req.params;
    try {
        // Confirm the voyage belongs to this transporter
        const [voyages] = await db.query('SELECT transporter_id, status FROM voyages WHERE id = ?', [voyageId]);
        if (voyages.length === 0) return res.status(404).json({ error: 'Voyage introuvable' });
        if (voyages[0].transporter_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });
        if (voyages[0].status === 'in_progress') return res.status(400).json({ error: 'Impossible de retirer un client pendant un voyage en cours' });

        // Confirm the delivery is linked to this voyage
        const [deliveries] = await db.query(
            'SELECT id, client_id, status FROM deliveries WHERE id = ? AND voyage_id = ?',
            [deliveryId, voyageId]
        );
        if (deliveries.length === 0) return res.status(404).json({ error: 'Réservation introuvable sur ce voyage' });
        const d = deliveries[0];

        if (d.status === 'In Transit' || d.status === 'Delivered') {
            return res.status(400).json({ error: 'Impossible de retirer un colis déjà en transit ou livré' });
        }

        // Reset the delivery: detach from voyage & transporter, back to Pending
        await db.query(
            'UPDATE deliveries SET status = "Pending", transporter_id = NULL, voyage_id = NULL, pickup_status = "pending" WHERE id = ?',
            [deliveryId]
        );

        // Notify the client via a system message
        await db.query(
            'INSERT INTO messages (id, delivery_id, sender_id, recipient_id, content, message_type) VALUES (?, ?, ?, ?, ?, ?)',
            [generateUUID(), deliveryId, req.user.id, d.client_id,
             '🚫 Le transporteur vous a retiré de ce voyage. Votre demande est à nouveau disponible.',
             'system']
        );

        res.json({ message: 'Client retiré du voyage avec succès' });
    } catch (err) {
        console.error('DELETE /voyages/:id/clients/:deliveryId Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

module.exports = router;
