const db = require('./src/config/db');

async function migrate() {
    try {
        console.log("Starting migration for transporter registration requirements...");

        // 1. Add terms_accepted columns to transporter_profiles if they don't exist
        try {
            await db.query(`ALTER TABLE transporter_profiles ADD COLUMN terms_accepted BOOLEAN NOT NULL DEFAULT FALSE`);
            console.log("Added terms_accepted column");
        } catch (e) {
            console.log("Note: terms_accepted column might already exist.");
        }

        try {
            await db.query(`ALTER TABLE transporter_profiles ADD COLUMN terms_accepted_at TIMESTAMP NULL`);
            console.log("Added terms_accepted_at column");
        } catch (e) {
            console.log("Note: terms_accepted_at column might already exist.");
        }

        // 2. Add 'vehicle_photo' to doc_type ENUM in transporter_documents
        // MySQL ALTER ENUM requires rewriting the ENUM.
        try {
            await db.query(`
                ALTER TABLE transporter_documents 
                MODIFY COLUMN doc_type ENUM('driver_license', 'national_id', 'insurance', 'vehicle_registration', 'vehicle_photo', 'other') NOT NULL
            `);
            console.log("Updated transporter_documents doc_type ENUM to include 'vehicle_photo'");
        } catch (e) {
            console.log("Error updating ENUM: ", e.message);
        }

        console.log("\n✅ Database migration for registration requirements completed successfully.");
        process.exit(0);
    } catch (err) {
        console.error("❌ Migration failed:", err);
        process.exit(1);
    }
}

migrate();
