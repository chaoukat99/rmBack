const db = require('./src/config/db');

async function migrate() {
    try {
        console.log('--- STARTING SUBSCRIPTION MIGRATION ---');

        // 1. Add subscription_status to transporter_profiles
        // ENUM('none', 'pending', 'active')
        await db.query(`
            ALTER TABLE transporter_profiles 
            ADD COLUMN IF NOT EXISTS subscription_status ENUM('none', 'pending', 'active') NOT NULL DEFAULT 'none'
        `);

        console.log('✅ Added subscription_status to transporter_profiles');

        console.log('--- MIGRATION COMPLETED SUCCESSFULLY ---');
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration failed:', err);
        process.exit(1);
    }
}

migrate();
