/**
 * migrate_v3.js — Production Upgrade Migration
 * Adds pickup_forms, receipts tables, extends message types, 
 * adds push_token + city to users, adds password_reset_tokens table.
 *
 * Usage: node migrate_v3.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const db = require('./src/config/db');

async function run() {
    console.log('🚀 Starting v3 migration...\n');

    const steps = [
        {
            name: 'Extend messages.message_type enum',
            sql: `
                ALTER TABLE messages 
                MODIFY COLUMN message_type 
                ENUM('text','image','audio','file','system','pickup_request','pickup_accepted','form_request','pickup_form','receipt')
                NOT NULL DEFAULT 'text'
            `,
        },
        {
            name: 'Add push_token column to users',
            sql: `ALTER TABLE users ADD COLUMN push_token VARCHAR(500) DEFAULT NULL`,
        },
        {
            name: 'Add city column to users',
            sql: `ALTER TABLE users ADD COLUMN city VARCHAR(100) DEFAULT NULL`,
        },
        {
            name: 'Add notification_prefs column to users',
            sql: `ALTER TABLE users ADD COLUMN notification_prefs JSON DEFAULT NULL`,
        },
        {
            name: 'Add password_reset_tokens table',
            sql: `
                CREATE TABLE IF NOT EXISTS password_reset_tokens (
                    id VARCHAR(36) PRIMARY KEY,
                    user_id VARCHAR(36) NOT NULL,
                    token VARCHAR(255) NOT NULL UNIQUE,
                    expires_at TIMESTAMP NOT NULL,
                    used TINYINT(1) NOT NULL DEFAULT 0,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
            `,
        },
        {
            name: 'Create pickup_forms table',
            sql: `
                CREATE TABLE IF NOT EXISTS pickup_forms (
                    id VARCHAR(36) PRIMARY KEY,
                    delivery_id VARCHAR(36) NOT NULL,
                    sender_name VARCHAR(255),
                    sender_phone VARCHAR(30),
                    sender_address TEXT,
                    recipient_name VARCHAR(255),
                    recipient_phone VARCHAR(30),
                    recipient_address TEXT,
                    parcel_description TEXT,
                    parcel_weight VARCHAR(50),
                    special_instructions TEXT,
                    submitted_by VARCHAR(36) NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
                    FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE CASCADE,
                    INDEX idx_pf_delivery (delivery_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
            `,
        },
        {
            name: 'Create receipts table',
            sql: `
                CREATE TABLE IF NOT EXISTS receipts (
                    id VARCHAR(36) PRIMARY KEY,
                    delivery_id VARCHAR(36) NOT NULL,
                    receipt_number VARCHAR(50) NOT NULL UNIQUE,
                    transporter_id VARCHAR(36) NOT NULL,
                    client_id VARCHAR(36) NOT NULL,
                    qr_data TEXT,
                    qr_image_url VARCHAR(500),
                    pdf_url VARCHAR(500),
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
                    FOREIGN KEY (transporter_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
                    INDEX idx_receipt_delivery (delivery_id),
                    INDEX idx_receipt_number (receipt_number)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
            `,
        },
        {
            name: 'Add notification_id column to notifications (for deep links)',
            sql: `ALTER TABLE notifications ADD COLUMN reference_id VARCHAR(36) DEFAULT NULL`,
        },
    ];

    let passed = 0;
    let failed = 0;

    for (const step of steps) {
        try {
            await db.query(step.sql.trim());
            console.log(`  ✅ ${step.name}`);
            passed++;
        } catch (err) {
            if (
                err.code === 'ER_DUP_FIELDNAME' ||
                err.code === 'ER_TABLE_EXISTS_ERROR' ||
                (err.message && err.message.includes('Duplicate column name'))
            ) {
                console.log(`  ⚠️  ${step.name} — already applied, skipping`);
                passed++;
            } else {
                console.error(`  ❌ ${step.name} — FAILED: ${err.message}`);
                failed++;
            }
        }
    }

    console.log(`\n📊 Migration complete: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
    console.error('Fatal migration error:', err);
    process.exit(1);
});
