const mysql = require('mysql2/promise');
require('dotenv').config();
const fs = require('fs');

async function dropAllTables() {
    console.log('🗑️ Starting database reset (dropping all tables)...');
    console.log(`📍 Host: ${process.env.DB_HOST}`);
    console.log(`📦 Database: ${process.env.DB_NAME}`);

    const config = {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 3306,
        multipleStatements: true,
        ssl: process.env.DB_SSL === 'true' ? {
            rejectUnauthorized: true,
            ca: process.env.DB_CA_CERT_PATH ? fs.readFileSync(process.env.DB_CA_CERT_PATH) : undefined
        } : undefined
    };

    try {
        const connection = await mysql.createConnection(config);
        
        // 1. Disable foreign key checks
        await connection.query('SET FOREIGN_KEY_CHECKS = 0;');
        console.log('🔓 Foreign key checks disabled.');

        // 2. Get all table names
        const [rows] = await connection.query('SHOW TABLES');
        const tables = rows.map(row => Object.values(row)[0]);

        if (tables.length === 0) {
            console.log('ℹ️ No tables found in the database.');
        } else {
            console.log(`📋 Found ${tables.length} tables: ${tables.join(', ')}`);
            
            // 3. Drop each table
            for (const table of tables) {
                await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
                console.log(`✅ Dropped table: ${table}`);
            }
        }

        // 4. Re-enable foreign key checks
        await connection.query('SET FOREIGN_KEY_CHECKS = 1;');
        console.log('🔒 Foreign key checks re-enabled.');

        await connection.end();
        console.log('✨ All tables dropped successfully.');
    } catch (error) {
        console.error('❌ Error dropping tables:', error.message);
    }
}

dropAllTables();
