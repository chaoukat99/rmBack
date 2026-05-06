const jwt = require('jsonwebtoken');
require('dotenv').config();

const generateToken = (userId, role) => {
    return jwt.sign(
        { id: userId, role: role },
        process.env.JWT_SECRET || 'fallback_secret_for_development_only',
        { expiresIn: '7d' } // Token expires in 7 days
    );
};

const verifyToken = (token) => {
    return jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_for_development_only');
};

module.exports = { generateToken, verifyToken };
