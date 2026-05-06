const crypto = require('crypto');

const generateUUID = () => crypto.randomUUID();

module.exports = { generateUUID };
