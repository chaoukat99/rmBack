const db = require('./src/config/db');

async function clearDatabaseKeepRecentUsers() {
    try {
        console.log('Starting full data cleanup...');

        // Disable foreign key checks to allow truncating tables
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
                console.log('-> Cleaning `users` table (keeping admins and users created today)...');
                const [result] = await db.query(`
                    DELETE FROM users 
                    WHERE DATE(created_at) < CURDATE() 
                    AND role != 'admin'
                `);
                console.log(`   Deleted ${result.affectedRows} old user(s).`);
            } else if (tableName === 'admin' || tableName === 'admins') {
                console.log(`-> Skipping \`${tableName}\` table entirely...`);
            } else {
                console.log(`-> Truncating table: \`${tableName}\`...`);
                await db.query(`TRUNCATE TABLE \`${tableName}\``);
            }
        }

        // Re-enable foreign key checks
        await db.query('SET FOREIGN_KEY_CHECKS = 1');

        console.log('✅ All other table data cleared successfully. Old users deleted.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error clearing data:', err);
        try {
            await db.query('SET FOREIGN_KEY_CHECKS = 1');
        } catch (e) {}
        process.exit(1);
    }
}

clearDatabaseKeepRecentUsers();
