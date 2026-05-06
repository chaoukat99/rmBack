const mysql = require('mysql2/promise');

async function migrate() {
    try {
        const db = await mysql.createConnection({
            host: 'localhost',
            user: 'root',
            password: '',
            database: 'rm_tawssil'
        });

        console.log('--- MIGRATING SUBSCRIPTIONS ---');
        
        // Add subscription_status to transporter_profiles if not exists
        await db.query(`
            ALTER TABLE transporter_profiles 
            ADD COLUMN IF NOT EXISTS subscription_status ENUM('none', 'pending', 'active', 'expired') NOT NULL DEFAULT 'none'
        `);

        // Create transporter_subscriptions table
        await db.query(`
            CREATE TABLE IF NOT EXISTS transporter_subscriptions (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                receipt_url VARCHAR(500) NOT NULL,
                status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
                amount DECIMAL(10, 2) DEFAULT 2000.00,
                admin_note TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        console.log('✅ Migration successful');
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration failed:', err);
        process.exit(1);
    }
}

migrate();
