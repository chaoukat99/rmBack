// A simple wrapper to use Zod for payload validation
const validate = (schema) => (req, res, next) => {
    try {
        schema.parse(req.body);
        next();
    } catch (err) {
        if (err.errors) {
            // Zod validation errors
            return res.status(400).json({ error: 'Validation Error', details: err.errors });
        }
        return res.status(500).json({ error: 'Internal Server Error during validation' });
    }
};

module.exports = { validate };
