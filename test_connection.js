const mysql = require('mysql2/promise');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function testConnection() {
    const sqlFilePath = path.join(__dirname, 'rm_tawssil.sql');

    console.log('🚀 Testing connection and loading SQL file...');
    console.log(`📍 Host: ${process.env.DB_HOST}`);
    console.log(`👤 User: ${process.env.DB_USER}`);
    console.log(`📦 Database: ${process.env.DB_NAME}`);
    console.log(`📄 SQL File: ${sqlFilePath}`);

    try {
        const baseConfig = {
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            port: process.env.DB_PORT || 3306,
            multipleStatements: true,
            ssl: process.env.DB_SSL === 'true' ? {
                rejectUnauthorized: true,
                ca: process.env.DB_CA_CERT_PATH ? fs.readFileSync(process.env.DB_CA_CERT_PATH) : undefined
            } : undefined
        };

        // 1. Connect without specifying the database first
        console.log('🔗 Connecting to MySQL server...');
        const connection = await mysql.createConnection(baseConfig);
        console.log('✅ Connected to server.');

        // 2. Create database if it doesn't exist
        console.log(`🛠️ Ensuring database "${process.env.DB_NAME}" exists...`);
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\`;`);
        await connection.query(`USE \`${process.env.DB_NAME}\`;`);
        console.log(`✅ Database "${process.env.DB_NAME}" is ready.`);

        // 3. Read and execute SQL file
        if (fs.existsSync(sqlFilePath)) {
            console.log('⏳ Loading SQL script (this may take a few seconds)...');
            const sql = fs.readFileSync(sqlFilePath, 'utf8');
            await connection.query(sql);
            console.log('✅ SQL script executed successfully!');
        } else {
            console.warn(`⚠️ SQL file not found at ${sqlFilePath}`);
        }

        const [rows] = await connection.query('SELECT 1 + 1 AS solution');
        console.log('✅ Final verification successful! Solution:', rows[0][0]?.solution || rows[0]?.solution);

        // List all tables created
        console.log('\n📊 Tables in database:');
        const [tables] = await connection.query('SHOW TABLES');
        if (tables.length > 0) {
            tables.forEach(row => console.log(` - ${Object.values(row)[0]}`));
        } else {
            console.log(' - No tables found.');
        }

        // Show data from users table
        console.log('\n👥 Users in database:');
        const [users] = await connection.query('SELECT id, name, email, role, status FROM users');
        if (users.length > 0) {
            console.table(users);
        } else {
            console.log(' - No users found.');
        }
        
        await connection.end();
        console.log('\n👋 Connection closed.');
    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.log('💡 Hint: Check if the DB_HOST and DB_PORT are correct and if the database is accessible from your current IP.');
        } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            console.log('💡 Hint: Check your DB_USER and DB_PASSWORD. Ensure the user has permissions to create databases.');
        }
    }
}

testConnection();
