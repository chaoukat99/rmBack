const { S3Client } = require('@aws-sdk/client-s3');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'eu-west-3',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    // Add endpoint if using custom Lightsail endpoint if needed, but standard S3 config often works
    }
});

module.exports = s3Client;
