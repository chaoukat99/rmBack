const mysql = require('mysql2/promise');
require('dotenv').config();
const fs = require('fs');

async function queryUsers() {
    console.log('🔍 Querying users from database...');
    
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

        const [users] = await connection.query('SELECT id, name, email, role, status, created_at FROM users');
        
        if (users.length > 0) {
            console.log(`\n👥 Found ${users.length} users:`);
            console.table(users);
        } else {
            console.log('\nℹ️ No users found in the database.');
        }

        await connection.end();
        console.log('\n👋 Connection closed.');
    } catch (error) {
        console.error('❌ Error querying database:', error.message);
    }
}

queryUsers();
