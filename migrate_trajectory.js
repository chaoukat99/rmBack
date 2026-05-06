const db = require('./src/config/db');

async function migrate() {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS transporter_trajectories (
                id VARCHAR(36) PRIMARY KEY,
                transporter_id VARCHAR(36) NOT NULL,
                from_country VARCHAR(100) NOT NULL,
                from_city VARCHAR(100) NOT NULL,
                to_country VARCHAR(100) NOT NULL,
                to_city VARCHAR(100) NOT NULL,
                status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (transporter_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_traj_transporter (transporter_id),
                INDEX idx_traj_status (status)
            )
        `);
        console.log("Migration successful");
        process.exit(0);
    } catch(err) {
        console.error(err);
        process.exit(1);
    }
}
migrate();
