const db = require('../src/config/db');

async function checkData() {
    try {
        console.log('--- Support Tickets ---');
        const [tickets] = await db.query('SELECT * FROM support_tickets');
        console.log(JSON.stringify(tickets, null, 2));

        console.log('\n--- Reclamations ---');
        const [reclamations] = await db.query('SELECT * FROM reclamations');
        console.log(JSON.stringify(reclamations, null, 2));

        console.log('\n--- Users ---');
        const [users] = await db.query('SELECT id, name, email, role FROM users');
        console.log(JSON.stringify(users, null, 2));

        console.log('\n--- Deliveries ---');
        const [deliveries] = await db.query('SELECT id, tracking_code FROM deliveries');
        console.log(JSON.stringify(deliveries, null, 2));

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkData();
