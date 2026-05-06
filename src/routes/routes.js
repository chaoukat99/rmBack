const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const { generateUUID } = require('../utils/uuid');
const { createShippingRouteSchema } = require('../utils/validations');

// ─────────────────────────────────────────────────────────────────────
// GET /api/routes
// List all active shipping corridors (public — no auth required for browsing)
// ─────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const params = [];
        let whereClause = 'WHERE is_active = TRUE';

        if (req.query.from) {
            whereClause += ' AND from_country LIKE ?';
            params.push(`%${req.query.from}%`);
        }
        if (req.query.to) {
            whereClause += ' AND to_country LIKE ?';
            params.push(`%${req.query.to}%`);
        }

        const [routes] = await db.query(`
            SELECT id, from_country, to_country, cities, distance_km,
                   avg_duration_days, avg_price, popularity, active_transporters
            FROM   shipping_routes
            ${whereClause}
            ORDER BY popularity DESC
        `, params);

        // Parse JSON cities field
        const formattedRoutes = routes.map(r => ({
            ...r,
            cities: typeof r.cities === 'string' ? JSON.parse(r.cities) : r.cities,
        }));

        res.json(formattedRoutes);
    } catch (err) {
        console.error('GET /routes Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/routes/:id  — Get single shipping route details
// ─────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM shipping_routes WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Route introuvable' });

        const route = rows[0];
        route.cities = typeof route.cities === 'string' ? JSON.parse(route.cities) : route.cities;

        res.json(route);
    } catch (err) {
        console.error('GET /routes/:id Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/routes  — Create a new shipping route (admin only)
// ─────────────────────────────────────────────────────────────────────
router.post('/', authenticate, authorizeRoles('admin'), async (req, res) => {
    const result = createShippingRouteSchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ error: 'Validation échouée', details: result.error.errors });
    }

    const { from_country, to_country, cities, distance_km, avg_duration_days, avg_price } = result.data;

    try {
        const routeId = generateUUID();
        await db.query(`
            INSERT INTO shipping_routes
              (id, from_country, to_country, cities, distance_km, avg_duration_days, avg_price)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [routeId, from_country, to_country, JSON.stringify(cities), distance_km || null, avg_duration_days || null, avg_price || null]);

        res.status(201).json({
            message: 'Route créée avec succès',
            id: routeId,
        });
    } catch (err) {
        console.error('POST /routes Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/routes/:id  — Update a route (admin only)
// ─────────────────────────────────────────────────────────────────────
router.patch('/:id', authenticate, authorizeRoles('admin'), async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id FROM shipping_routes WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Route introuvable' });

        const { avg_price, avg_duration_days, active_transporters, popularity, is_active } = req.body;

        await db.query(`
            UPDATE shipping_routes
            SET    avg_price = COALESCE(?, avg_price),
                   avg_duration_days = COALESCE(?, avg_duration_days),
                   active_transporters = COALESCE(?, active_transporters),
                   popularity = COALESCE(?, popularity),
                   is_active = COALESCE(?, is_active)
            WHERE  id = ?
        `, [
            avg_price ?? null,
            avg_duration_days ?? null,
            active_transporters ?? null,
            popularity ?? null,
            is_active ?? null,
            req.params.id,
        ]);

        res.json({ message: 'Route mise à jour', id: req.params.id });
    } catch (err) {
        console.error('PATCH /routes/:id Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// DELETE /api/routes/:id  — Deactivate/delete a route (admin only)
// ─────────────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, authorizeRoles('admin'), async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id FROM shipping_routes WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Route introuvable' });

        // Soft delete — just deactivate
        await db.query('UPDATE shipping_routes SET is_active = FALSE WHERE id = ?', [req.params.id]);
        res.json({ message: 'Route désactivée avec succès' });
    } catch (err) {
        console.error('DELETE /routes/:id Error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

module.exports = router;
