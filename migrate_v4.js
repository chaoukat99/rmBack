const db = require('./src/config/db');

async function migrate() {
    try {
        console.log('Migrating users table...');
        try {
            await db.query(`
                ALTER TABLE users 
                ADD COLUMN push_token VARCHAR(255) DEFAULT NULL,
                ADD COLUMN reset_code VARCHAR(10) DEFAULT NULL,
                ADD COLUMN reset_code_expiry DATETIME DEFAULT NULL
            `);
            console.log('users table updated or already up to date.');
        } catch (err) {
            if (!err.message.includes('Duplicate column')) {
                throw err;
            }
            console.log('users table already contains columns.');
        }

        console.log('Migrating messages table message_type enum...');
        await db.query(`
            ALTER TABLE messages 
            MODIFY COLUMN message_type ENUM('text','image','audio','file','pickup_request','pickup_accepted','form_request','pickup_form','receipt','system') NOT NULL DEFAULT 'text'
        `);
        console.log('messages table updated.');

        console.log('Migration completed successfully!');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
