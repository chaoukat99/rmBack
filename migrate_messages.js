const db = require('./src/config/db');

async function migrate() {
    try {
        console.log('Altering messages table...');
        await db.query(`
            ALTER TABLE messages 
            MODIFY COLUMN message_type ENUM('text', 'image', 'audio', 'file', 'pickup_request', 'pickup_accepted') NOT NULL DEFAULT 'text'
        `);
        console.log('Success!');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
