const db = require('./src/config/db');

async function deleteOldUsers() {
    try {
        console.log("Starting deletion of old non-admin users...");
        
        // Find users to delete
        const [users] = await db.execute(`
            SELECT id FROM users 
            WHERE DATE(created_at) < CURDATE() 
            AND role != 'admin'
        `);

        if (users.length === 0) {
            console.log("No old users found to delete.");
            process.exit(0);
            return;
        }

        const userIds = users.map(u => u.id);
        console.log(`Found ${userIds.length} user(s) to delete.`);
        
        let success = false;
        let attempts = 0;
        
        while (!success && attempts < 20) {
            try {
                attempts++;
                const [result] = await db.query(`
                    DELETE FROM users 
                    WHERE DATE(created_at) < CURDATE() 
                    AND role != 'admin'
                `);
                console.log(`Successfully deleted ${result.affectedRows} user(s) and their associated records.`);
                success = true;
            } catch (error) {
                if (error.code === 'ER_ROW_IS_REFERENCED_2') {
                    // Extract table and column name from error message
                    // Example: Cannot delete or update a parent row: a foreign key constraint fails (`db`.`table`, CONSTRAINT `c` FOREIGN KEY (`col`) REFERENCES `users` (`id`))
                    const match = error.message.match(/a foreign key constraint fails \(`[^`]+`\.`([^`]+)`, CONSTRAINT `[^`]+` FOREIGN KEY \(`([^`]+)`\) REFERENCES `users` \(`id`\)\)/);
                    if (match) {
                        const tableName = match[1];
                        const columnName = match[2];
                        console.log(`Foreign key constraint failed on ${tableName}.${columnName}. Deleting dependent rows...`);
                        
                        // Delete dependent rows
                        const placeholders = userIds.map(() => '?').join(',');
                        const deleteQuery = `DELETE FROM ${tableName} WHERE ${columnName} IN (${placeholders})`;
                        const [delResult] = await db.query(deleteQuery, userIds);
                        console.log(`Deleted ${delResult.affectedRows} dependent row(s) from ${tableName}. Retrying user deletion...`);
                    } else {
                        console.error("Could not parse foreign key constraint error:", error.message);
                        throw error;
                    }
                } else {
                    throw error;
                }
            }
        }
        
        if (!success) {
            console.error("Failed to delete users after multiple attempts due to constraints.");
        }

    } catch (error) {
        console.error("Error executing deletion:", error);
    } finally {
        process.exit(0);
    }
}

deleteOldUsers();
