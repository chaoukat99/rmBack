const multer = require('multer');
const multerS3 = require('multer-s3');
const s3Client = require('../config/s3');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const uploadBucket = process.env.AWS_BUCKET_NAME;

// S3 Storage Configuration
const s3Storage = multerS3({
    s3: s3Client,
    bucket: uploadBucket,
    metadata: function (req, file, cb) {
        cb(null, { fieldName: file.fieldname });
    },
    contentType: (req, file, cb) => cb(null, file.mimetype), // avoid extra S3 HEAD per file (was AUTO_CONTENT_TYPE)
    key: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const folder = file.mimetype.startsWith('audio/') ? 'audio/' : (file.mimetype.startsWith('image/') ? 'images/' : 'documents/');
        cb(null, 'uploads/' + folder + file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// Configure Multer limits and storage
const upload = multer({
    storage: s3Storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

module.exports = upload;
