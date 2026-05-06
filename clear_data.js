const db = require('./src/config/db');

async function clearAllExceptAdmin() {
    try {
        console.log('Starting data cleanup...');

        // Disable foreign key checks temporarily to allow truncating tables with foreign keys
        await db.query('SET FOREIGN_KEY_CHECKS = 0');

        // Fetch all table names dynamically
        const [tables] = await db.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = DATABASE()
        `);

        for (const row of tables) {
            const tableName = row.TABLE_NAME || row.table_name;
            
            if (tableName === 'users') {
                console.log('-> Clearing non-admin users from `users` table...');
                // Delete everyone except admins
                await db.query(`DELETE FROM users WHERE role != 'admin'`);
            } else if (tableName === 'admin' || tableName === 'admins') {
                console.log(`-> Skipping \`${tableName}\` table entirely...`);
            } else {
                console.log(`-> Truncating table: \`${tableName}\`...`);
                await db.query(`TRUNCATE TABLE \`${tableName}\``);
            }
        }

        // Re-enable foreign key checks
        await db.query('SET FOREIGN_KEY_CHECKS = 1');

        console.log('✅ All data cleared successfully (Admin data preserved).');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error clearing data:', err);
        try {
            await db.query('SET FOREIGN_KEY_CHECKS = 1');
        } catch (e) {}
        process.exit(1);
    }
}

clearAllExceptAdmin();
