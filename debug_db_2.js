const mysql = require('mysql2/promise');

async function check() {
    const db = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '',
        database: 'rm_tawssil'
    });
    
    console.log('--- ALL DELIVERIES ---');
    const [deliveries] = await db.query('SELECT id, status, origin, destination, transporter_id FROM deliveries');
    console.log(deliveries);
    
    console.log('--- PENDING DELIVERIES ---');
    const [pending] = await db.query("SELECT id FROM deliveries WHERE status = 'Pending'");
    console.log('Count:', pending.length);
    
    process.exit(0);
}

check().catch(console.error);
