const db = require('./src/config/db');

async function migrate() {
    console.log('Starting Support Tickets migration (V3)...');
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS support_tickets (
                id           VARCHAR(36)  PRIMARY KEY,
                user_id      VARCHAR(36)  NOT NULL,
                subject      VARCHAR(255) NOT NULL,
                description  TEXT         NOT NULL,
                status       ENUM('open', 'replied', 'closed') NOT NULL DEFAULT 'open',
                admin_reply  TEXT,
                created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_ticket_user (user_id),
                INDEX idx_ticket_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        console.log('✅ Table support_tickets verified/created.');

        try {
            // Check if constraint already exists
            const [rows] = await db.query(`
                SELECT CONSTRAINT_NAME 
                FROM information_schema.KEY_COLUMN_USAGE 
                WHERE TABLE_NAME = 'support_tickets' AND CONSTRAINT_NAME = 'fk_support_tickets_user'
                AND TABLE_SCHEMA = DATABASE()
            `);

            if (rows.length === 0) {
                console.log('Adding foreign key constraint...');
                await db.query(`
                    ALTER TABLE support_tickets 
                    ADD CONSTRAINT fk_support_tickets_user 
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                `);
                console.log('✅ Constraint added successfully.');
            } else {
                console.log('ℹ️ Constraint already exists.');
            }
        } catch (fkError) {
            console.error('❌ Failed to add constraint:', fkError.message);
            if (fkError.code === 'ER_CANNOT_ADD_FOREIGN_KEY') {
                console.log('Potential issues: Mismatched types, users.id missing, or table engine mismatch.');
            }
        }

    } catch (err) {
        console.error('💥 Migration failed critically:', err);
    } finally {
        process.exit();
    }
}

migrate();
