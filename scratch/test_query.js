const mysql = require('mysql2/promise');
require('dotenv').config({ path: '../.env' });

async function test() {
    const db = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 3306,
    });

    const userId = 'caac6289-acc0-410e-8557-4185764f6918'; // dummy ID for test
    const role = 'client';
    const params = [userId, userId];

    try {
        const [rows] = await db.query(`
            SELECT
                d.id AS delivery_id,
                d.origin, d.destination, d.status,
                c.id AS client_id, c.name AS client_name, c.avatar AS client_avatar,
                t.id AS transporter_id, t.name AS transporter_name, t.avatar AS transporter_avatar,
                (
                    SELECT content FROM messages m2
                    WHERE m2.delivery_id = d.id
                    ORDER BY m2.created_at DESC LIMIT 1
                ) AS last_message,
                (
                    SELECT message_type FROM messages m2
                    WHERE m2.delivery_id = d.id
                    ORDER BY m2.created_at DESC LIMIT 1
                ) AS last_message_type,
                (
                    SELECT created_at FROM messages m2
                    WHERE m2.delivery_id = d.id
                    ORDER BY m2.created_at DESC LIMIT 1
                ) AS last_message_at,
                (
                    SELECT COUNT(*) FROM messages m2
                    WHERE m2.delivery_id = d.id AND m2.recipient_id = ? AND m2.is_read = FALSE
                ) AS unread_count
            FROM deliveries d
            LEFT JOIN users c ON c.id = d.client_id
            LEFT JOIN users t ON t.id = d.transporter_id
            WHERE d.client_id = ?
            ORDER BY last_message_at DESC, d.created_at DESC
        `, params);
        console.log('Query successful, rows count:', rows.length);
    } catch (err) {
        console.error('Query failed:', err);
    } finally {
        await db.end();
    }
}

test();
