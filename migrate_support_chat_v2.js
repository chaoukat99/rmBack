const db = require('./src/config/db');

async function migrate() {
    console.log('Starting Support Chat v2 migration...');
    try {
        // Add message_type column
        try {
            await db.query(`ALTER TABLE support_messages ADD COLUMN message_type VARCHAR(20) NOT NULL DEFAULT 'text'`);
            console.log('✅ Added message_type column');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME') console.log('ℹ️ message_type already exists');
            else throw err;
        }

        // Add file_url column
        try {
            await db.query(`ALTER TABLE support_messages ADD COLUMN file_url TEXT NULL`);
            console.log('✅ Added file_url column');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME') console.log('ℹ️ file_url already exists');
            else throw err;
        }

        // Add file_size column
        try {
            await db.query(`ALTER TABLE support_messages ADD COLUMN file_size INT NULL`);
            console.log('✅ Added file_size column');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME') console.log('ℹ️ file_size already exists');
            else throw err;
        }

        console.log('\n🚀 Support Chat v2 migration complete!');
    } catch (err) {
        console.error('💥 Migration failed:', err);
    } finally {
        process.exit(0);
    }
}

migrate();
