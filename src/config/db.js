const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'rm_tawssil',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: process.env.DB_SSL === 'true' ? {
        rejectUnauthorized: false,
        // If a CA cert is provided in .env, use it
        ca: process.env.DB_CA_CERT_PATH ? require('fs').readFileSync(process.env.DB_CA_CERT_PATH) : undefined
    } : undefined
});

module.exports = pool;
