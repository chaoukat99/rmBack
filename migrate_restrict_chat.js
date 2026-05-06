const mysql = require('mysql2/promise');
require('dotenv').config();
const fs = require('fs');

async function migrate() {
    const config = {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 3306,
        ssl: process.env.DB_SSL === 'true' ? {
            rejectUnauthorized: true,
            ca: process.env.DB_CA_CERT_PATH ? fs.readFileSync(process.env.DB_CA_CERT_PATH) : undefined
        } : undefined
    };

    try {
        const connection = await mysql.createConnection(config);
        console.log('✅ Connected to database.');

        await connection.query(`
            ALTER TABLE transporter_profiles 
            ADD COLUMN messaging_disabled BOOLEAN DEFAULT FALSE
        `);
        console.log('✅ Added messaging_disabled column to transporter_profiles.');

        await connection.end();
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
    }
}

migrate();
