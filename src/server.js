const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// ─────────────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

// Ensure upload directories exist
const fs = require('fs');
['uploads', 'uploads/messages', 'uploads/subscriptions'].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Created directory: ${dir}`);
    }
});

// ─────────────────────────────────────────────────────────────────────
// Static File Serving (BEFORE helmet so files are served without restriction)
// ─────────────────────────────────────────────────────────────────────
app.use('/uploads', express.static('uploads'));

// ─────────────────────────────────────────────────────────────────────
// Security Middlewares
// ─────────────────────────────────────────────────────────────────────
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow images/audio from other origins
}));


// Rate Limiting — stricter for auth, relaxed for general API
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 20,                  // 20 auth attempts per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Trop de tentatives de connexion, réessayez dans 15 minutes.' },
});

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 1000,                // 1000 general API requests per window (increased from 200)
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Trop de requêtes, réessayez dans 15 minutes.' },
});

app.use('/api/auth',    authLimiter);
app.use('/api',         apiLimiter);

// Simple Request Logging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// ─────────────────────────────────────────────────────────────────────
// CORS Configuration
// ─────────────────────────────────────────────────────────────────────
const corsOptions = {
    origin: process.env.FRONTEND_URL || '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));

// ─────────────────────────────────────────────────────────────────────
// Body Parsing
// ─────────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));


// ─────────────────────────────────────────────────────────────────────
// Socket.IO — Real-time Chat & Live GPS Tracking
// ─────────────────────────────────────────────────────────────────────
const io = new Server(server, { cors: corsOptions });

// Expose io to routes (used by messages.js to broadcast new messages)
app.set('io', io);

io.on('connection', (socket) => {
    console.log('🔗 Nouvel utilisateur connecté :', socket.id);

    // ── Delivery Chat & Tracking Rooms ──────────────────────────────────
    // Join a delivery-specific room for chat & tracking
    socket.on('join_delivery', (deliveryId) => {
        socket.join(deliveryId);
        console.log(`📡 Socket ${socket.id} rejoint le canal livraison: ${deliveryId}`);
    });

    // Legacy direct emit support (for clients that still use socket for messages)
    socket.on('send_message', (data) => {
        socket.to(data.deliveryId).emit('receive_message', data);
    });

    // Leave delivery room
    socket.on('leave_delivery', (deliveryId) => {
        socket.leave(deliveryId);
        console.log(`📤 Socket ${socket.id} a quitté le canal: ${deliveryId}`);
    });

    // ── Support Ticket Chat Rooms ────────────────────────────────────────
    // Join a specific support ticket room
    socket.on('join_ticket', (ticketId) => {
        socket.join(`ticket_${ticketId}`);
        console.log(`🎫 Socket ${socket.id} rejoint le ticket: ${ticketId}`);
    });

    // Leave a specific support ticket room
    socket.on('leave_ticket', (ticketId) => {
        socket.leave(`ticket_${ticketId}`);
        console.log(`🚪 Socket ${socket.id} a quitté le ticket: ${ticketId}`);
    });

    // Support staff room — agents join this to get new ticket notifications
    socket.on('join_support_staff', () => {
        socket.join('support_staff');
        console.log(`👥 Socket ${socket.id} rejoint l'espace support`);
    });

    socket.on('disconnect', () => {
        console.log('❌ Utilisateur déconnecté :', socket.id);
    });
});

// ─────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────
const authRoutes          = require('./routes/auth');
const deliveriesRoutes    = require('./routes/deliveries');
const voyagesRoutes       = require('./routes/voyages');
const transportersRoutes  = require('./routes/transporters');
const messagesRoutes      = require('./routes/messages');
const notificationsRoutes = require('./routes/notifications');
const reclamationsRoutes  = require('./routes/reclamations');
const shippingRoutes      = require('./routes/routes');
const adminRoutes         = require('./routes/admin');
const subscriptionsRoutes = require('./routes/subscriptions');
const supportRoutes       = require('./routes/support');
const pdfsRoutes          = require('./routes/pdfs');
const mapsRoutes          = require('./routes/maps');


// Mount routes
app.use('/api/auth',           authRoutes);
app.use('/api/deliveries',     deliveriesRoutes);
app.use('/api/voyages',        voyagesRoutes);
app.use('/api/transporters',   transportersRoutes);
app.use('/api/messages',       messagesRoutes);
app.use('/api/notifications',  notificationsRoutes);
app.use('/api/reclamations',   reclamationsRoutes);
app.use('/api/routes',         shippingRoutes);
app.use('/api/admin',          adminRoutes);
app.use('/api/subscriptions',  subscriptionsRoutes);
app.use('/api/support',        supportRoutes);
app.use('/api/pdfs',           pdfsRoutes);
app.use('/api/maps',           mapsRoutes);



// ─────────────────────────────────────────────────────────────────────
// Health Check
// ─────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({
        status: 'success',
        message: '🚀 API Rm Tawssil en ligne',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
    });
});

// ─────────────────────────────────────────────────────────────────────
// 404 Handler
// ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({ error: `Route non trouvée: ${req.method} ${req.originalUrl}` });
});

// ─────────────────────────────────────────────────────────────────────
// Global Error Handler
// ─────────────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('SERVER ERROR:', err.stack);
    res.status(500).json({
        error: 'Erreur interne du serveur',
        ...(process.env.NODE_ENV !== 'production' && { details: err.message }),
    });
});

// ─────────────────────────────────────────────────────────────────────
// DB Pool Warm-up (avoid ~500ms cold-start cost on first request)
// ─────────────────────────────────────────────────────────────────────
const db = require('./config/db');
db.query('SELECT 1')
    .then(() => console.log('✅ DB pool warmed'))
    .catch((e) => console.warn('⚠️  DB warm-up failed:', e.message));

// ─────────────────────────────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`\n✅ Serveur Backend Rm Tawssil démarré`);
    console.log(`🌐 API:      http://localhost:${PORT}/api`);
    console.log(`❤️  Health:   http://localhost:${PORT}/api/health`);
    console.log(`⚡ Socket:   ws://localhost:${PORT}`);
    console.log(`📦 Mode:     ${process.env.NODE_ENV || 'development'}\n`);
});
