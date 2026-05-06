const db = require('./src/config/db');

async function migrate() {
    try {
        console.log('Altering deliveries table to make fields nullable...');
        
        // Under MySQL, we use ALTER TABLE MODIFY
        await db.query(`
            ALTER TABLE deliveries 
            MODIFY COLUMN origin VARCHAR(255) NULL,
            MODIFY COLUMN destination VARCHAR(255) NULL,
            MODIFY COLUMN pickup_address TEXT NULL,
            MODIFY COLUMN pickup_phone VARCHAR(30) NULL,
            MODIFY COLUMN package_type VARCHAR(100) NULL,
            MODIFY COLUMN weight VARCHAR(50) NULL,
            MODIFY COLUMN request_date DATE NULL,
            MODIFY COLUMN tracking_code VARCHAR(100) NULL
        `);

        console.log('Migration successful.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
