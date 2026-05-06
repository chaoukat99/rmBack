const db = require('./src/config/db');

async function migrate() {
    try {
        console.log('Altering deliveries table for smoother pickup workflow...');
        
        await db.query(`
            ALTER TABLE deliveries 
            MODIFY COLUMN pickup_status ENUM('pending', 'requested', 'accepted', 'completed') DEFAULT 'pending'
        `);

        console.log('Migration successful.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
