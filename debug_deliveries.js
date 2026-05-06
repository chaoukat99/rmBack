const mysql = require('mysql2/promise');
require('dotenv').config();

async function check() {
    const db = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '',
        database: 'rm_tawssil'
    });
    
    const [deliveries] = await db.query('SELECT id, status, origin, destination, transporter_id FROM deliveries');
    console.log('DELIVERIES:', deliveries);
    
    const [trajectories] = await db.query('SELECT * FROM transporter_trajectories');
    console.log('TRAJECTORIES:', trajectories);
    
    process.exit(0);
}

check().catch(console.error);
