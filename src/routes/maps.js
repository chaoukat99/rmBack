const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const puppeteer = require('puppeteer-core');
const db = require('../config/db');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const CITY_COORDS = {
    'Casablanca': [33.5731, -7.5898],
    'Paris': [48.8566, 2.3522],
    'Rabat': [34.0209, -6.8416],
    'Lyon': [45.7640, 4.8357],
    'Fez': [34.0331, -5.0003],
    'Barcelona': [41.3851, 2.1734],
    'Marrakech': [31.6295, -7.9811],
    'Marseille': [43.2965, 5.3698],
    'Tangier': [35.7595, -5.8340],
    'Madrid': [40.4168, -3.7038]
};

router.get('/screenshot/:deliveryId', async (req, res) => {
    try {
        const { deliveryId } = req.params;
        
        // 1. Fetch delivery details
        const [deliveries] = await db.query(
            'SELECT origin, destination, current_lat, current_lng, status FROM deliveries WHERE id = ?',
            [deliveryId]
        );

        if (deliveries.length === 0) return res.status(404).send('Not found');
        const d = deliveries[0];

        // 2. Prepare HTML for Leaflet
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
                <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
                <style>
                    #map { width: 600px; height: 350px; border-radius: 20px; }
                    .marker-pin { width: 30px; height: 30px; border-radius: 50% 50% 50% 0; background: #1E40AF; position: absolute; transform: rotate(-45deg); left: 50%; top: 50%; margin: -15px 0 0 -15px; }
                    .marker-pin::after { content: ''; width: 14px; height: 14px; margin: 8px 0 0 8px; background: #fff; position: absolute; border-radius: 50%; }
                </style>
            </head>
            <body style="margin: 0; padding: 0;">
                <div id="map"></div>
                <script>
                    const cityCoords = ${JSON.stringify(CITY_COORDS)};
                    
                    const origin = "${d.origin}";
                    const dest = "${d.destination}";
                    
                    const start = cityCoords[origin] || [33.5, -7.5];
                    const end = cityCoords[dest] || [48.8, 2.3];

                    const map = L.map('map', { zoomControl: false }).setView(start, 5);
                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

                    // Origin
                    L.marker(start, {icon: L.divIcon({className:'start-dot', html:'<div style="background:#00D4FF;width:12px;height:12px;border-radius:6px;border:2px solid #fff"></div>'})}).addTo(map);
                    
                    // Destination
                    L.marker(end, {icon: L.divIcon({className:'end-dot', html:'<div style="background:#10B981;width:12px;height:12px;border-radius:6px;border:2px solid #fff"></div>'})}).addTo(map);

                    // Transporter
                    if (${d.current_lat} && ${d.current_lng}) {
                        const truckIcon = L.divIcon({
                            className: 'truck-icon',
                            html: "<div style='background:#1E40AF;width:30px;height:30px;border-radius:15px;border:3px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-family:sans-serif;font-size:8px;font-weight:bold;box-shadow:0 2px 5px rgba(0,0,0,0.3)'>TRUCK</div>",
                            iconSize: [30, 30],
                            iconAnchor: [15, 15]
                        });
                        L.marker([${d.current_lat}, ${d.current_lng}], {icon: truckIcon, zIndexOffset: 1000}).addTo(map);
                        
                        // Fit bounds to show route
                        const group = new L.featureGroup([L.marker(start), L.marker(end), L.marker([${d.current_lat}, ${d.current_lng}])]);
                        map.fitBounds(group.getBounds().pad(0.2));
                    } else {
                        map.fitBounds(L.latLngBounds(start, end).pad(0.2));
                    }

                </script>
            </body>
            </html>
        `;

        // 3. Take screenshot with Puppeteer
        const browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome'
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 600, height: 350 });
        await page.setContent(html, { waitUntil: 'networkidle0' });
        
        const buffer = await page.screenshot({ type: 'png' });
        await browser.close();

        res.set('Content-Type', 'image/png');
        res.send(buffer);

    } catch (err) {
        console.error('Map screenshot error:', err);
        res.status(500).send('Error');
    }
});

module.exports = router;
