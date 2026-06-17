const db = require('./src/config/db');

// Creates the `client_trajectories` table — routes a client wants served
// ("request voyage"), surfaced to transporters. One can be set at registration;
// up to 5 are managed from the client profile (5-max enforced in the API layer,
// src/routes/clientTrajectories.js).
//
// Run:  node migrate_client_trajectories.js
async function migrate() {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS client_trajectories (
                id VARCHAR(36) PRIMARY KEY,
                client_id VARCHAR(36) NOT NULL,
                from_country VARCHAR(100) NOT NULL,
                from_city VARCHAR(100) NOT NULL,
                to_country VARCHAR(100) NOT NULL,
                to_city VARCHAR(100) NOT NULL,
                status ENUM('active', 'archived') NOT NULL DEFAULT 'active',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_client_traj_client (client_id),
                INDEX idx_client_traj_route (from_city, to_city)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
        `);
        console.log("Migration successful");
        process.exit(0);
    } catch(err) {
        console.error(err);
        process.exit(1);
    }
}
migrate();
