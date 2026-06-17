const { z } = require('zod');

// ─────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────
const registerSchema = z.object({
    name:     z.string().min(2,  'Le nom doit avoir au moins 2 caractères'),
    email:    z.string().email('Format email invalide'),
    password: z.string().min(6,  'Le mot de passe doit avoir au moins 6 caractères'),
    role:     z.enum(['client', 'transporter', 'support'], { errorMap: () => ({ message: 'Rôle invalide' }) }),
    phone:    z.string().min(8,  'Numéro de téléphone trop court'),
    trajectory: z.object({
        from_country: z.string().min(2),
        from_city:    z.string().min(2),
        to_country:   z.string().min(2),
        to_city:      z.string().min(2),
    }).optional(),
    trajectories: z.array(z.object({
        from_country: z.string().min(2),
        from_city:    z.string().min(2),
        to_country:   z.string().min(2),
        to_city:      z.string().min(2),
    })).optional(),
    // Verification documents (passed as filenames or objects after upload)
    driver_license: z.string().optional(),
    registration_document: z.string().optional(),
    vehicle_photos: z.union([z.string(), z.array(z.string())]).optional(),
});

const loginSchema = z.object({
    email:    z.string().email('Format email invalide'),
    password: z.string().min(1,  'Mot de passe requis'),
});

// ─────────────────────────────────────────
// DELIVERIES
// ─────────────────────────────────────────
const createDeliverySchema = z.object({
    origin:          z.string().min(2,  'Origine requise').optional(),
    destination:     z.string().min(2,  'Destination requise').optional(),
    pickup_address:  z.string().optional(),
    pickup_phone:    z.string().optional(),
    package_type:    z.string().min(2,  'Type de colis requis').optional(),
    weight:          z.string().min(1,  'Poids requis').optional(),
    dimensions:      z.string().optional(),
    description:     z.string().optional(),
    declared_value:  z.number().nonnegative().optional(),
    is_urgent:       z.boolean().optional().default(false),
    is_insured:      z.boolean().optional().default(false),
    request_date:    z.string().refine(d => !isNaN(Date.parse(d)), { message: 'Format date invalide' }).optional(),
    transporter_id:  z.string().uuid().optional(),
    voyage_id:       z.string().uuid().optional(),
});

const updateDeliveryStatusSchema = z.object({
    status: z.enum(['Pending', 'Accepted', 'In Transit', 'Delivered', 'Cancelled']),
});

const updatePickupStatusSchema = z.object({
    pickup_status: z.enum(['pending', 'requested', 'accepted', 'completed']),
});

const clientRequestPickupSchema = z.object({
    pickup_address: z.string().optional(),
    pickup_phone:   z.string().optional(),
    package_type:   z.string(),
    weight:         z.string(),
    request_date:   z.string().optional(),
});

const ratingSchema = z.object({
    delivery_id: z.string().uuid('ID de livraison invalide'),
    stars:       z.number().int().min(1).max(5, 'La note doit être entre 1 et 5'),
    comment:     z.string().max(500).optional(),
});

// ─────────────────────────────────────────
// VOYAGES
// ─────────────────────────────────────────
const createVoyageSchema = z.object({
    trajectory_id:      z.string().uuid('ID de trajet invalide').optional(),
    from_country:       z.string().optional(),
    from_city:          z.string().optional(),
    to_country:         z.string().optional(),
    to_city:            z.string().optional(),
    departure_date:     z.string().refine(d => !isNaN(Date.parse(d)), { message: 'Date de départ invalide' }),
    estimated_arrival:  z.string().refine(d => !isNaN(Date.parse(d)), { message: "Date d'arrivée invalide" }),
    available_capacity: z.string().optional(),
    price_per_kg:       z.number().positive('Le prix doit être positif').optional(),
    notes:              z.string().optional(),
});

const updateVoyageStatusSchema = z.object({
    status: z.enum(['upcoming', 'in_progress', 'completed', 'cancelled']),
});

// ─────────────────────────────────────────
// TRANSPORTER PROFILE
// ─────────────────────────────────────────
const updateTransporterProfileSchema = z.object({
    vehicle:          z.string().optional(),
    vehicle_capacity: z.string().optional(),
    license_number:   z.string().optional(),
    countries:        z.array(z.string()).optional(),
    bio:              z.string().max(1000).optional(),
});

const createTrajectorySchema = z.object({
    from_country: z.string().min(2, 'Pays de départ requis'),
    from_city:    z.string().min(2, 'Ville de départ requise'),
    to_country:   z.string().min(2, 'Pays de destination requis'),
    to_city:      z.string().min(2, 'Ville de destination requise'),
});

// Client "request voyage" trajectory (same shape as a transporter trajectory)
const createClientTrajectorySchema = z.object({
    from_country: z.string().min(2, 'Pays de départ requis'),
    from_city:    z.string().min(2, 'Ville de départ requise'),
    to_country:   z.string().min(2, 'Pays de destination requis'),
    to_city:      z.string().min(2, 'Ville de destination requise'),
});

const approveTransporterSchema = z.object({
    decision:    z.enum(['approved', 'rejected']),
    admin_note:  z.string().optional(),
});

// ─────────────────────────────────────────
// MESSAGES
// ─────────────────────────────────────────
const sendMessageSchema = z.object({
    content:      z.string().max(2000).optional(),
    recipient_id: z.string().uuid('ID destinataire invalide'),
    message_type: z.enum(['text', 'image', 'audio', 'file']).optional().default('text'),
});

// ─────────────────────────────────────────
// RECLAMATIONS
// ─────────────────────────────────────────
const createReclamationSchema = z.object({
    delivery_id:  z.string().min(1, 'ID de livraison requis'),
    subject:      z.string().min(5, 'Sujet requis (min 5 caractères)').max(255),
    description:  z.string().min(10, 'Description requise (min 10 caractères)'),
});

const resolveReclamationSchema = z.object({
    admin_note: z.string().optional(),
});

// ─────────────────────────────────────────
// SUPPORT TICKETS
// ─────────────────────────────────────────
const createTicketSchema = z.object({
    subject:     z.string().min(5, 'Sujet requis (min 5 caractères)').max(255),
    description: z.string().min(10, 'Description requise (min 10 caractères)'),
});

const replyTicketSchema = z.object({
    admin_reply: z.string().min(5, 'La réponse doit avoir au moins 5 caractères'),
});

// ─────────────────────────────────────────
// SHIPPING ROUTES (Admin)
// ─────────────────────────────────────────
const createShippingRouteSchema = z.object({
    from_country:       z.string().min(2),
    to_country:         z.string().min(2),
    cities:             z.array(z.string()).min(2, 'Au moins 2 villes requises'),
    distance_km:        z.number().int().positive().optional(),
    avg_duration_days:  z.number().int().positive().optional(),
    avg_price:          z.number().nonnegative().optional(),
});

// ─────────────────────────────────────────
// ADMIN — USER MANAGEMENT
// ─────────────────────────────────────────
const updateUserStatusSchema = z.object({
    status: z.enum(['active', 'suspended']),
});

const createSupportSchema = z.object({
    name:     z.string().min(2, 'Le nom doit avoir au moins 2 caractères'),
    email:    z.string().email('Format email invalide'),
    password: z.string().min(6, 'Le mot de passe doit avoir au moins 6 caractères'),
    phone:    z.string().min(8, 'Numéro de téléphone trop court').optional(),
});

// ─────────────────────────────────────────
// LOCATION
// ─────────────────────────────────────────
const updateLocationSchema = z.object({
    latitude: z.number().min(-90, 'Latitude invalide').max(90, 'Latitude invalide'),
    longitude: z.number().min(-180, 'Longitude invalide').max(180, 'Longitude invalide')
});

module.exports = {
    // Auth
    registerSchema,
    loginSchema,
    // Deliveries
    createDeliverySchema,
    updateDeliveryStatusSchema,
    updatePickupStatusSchema,
    ratingSchema,
    updateLocationSchema,
    // Voyages
    createVoyageSchema,
    updateVoyageStatusSchema,
    // Transporter
    updateTransporterProfileSchema,
    approveTransporterSchema,
    createTrajectorySchema,
    createClientTrajectorySchema,
    // Messages
    sendMessageSchema,
    // Reclamations
    createReclamationSchema,
    // Support Tickets
    createTicketSchema,
    replyTicketSchema,
    // Routes
    createShippingRouteSchema,
    // Admin
    updateUserStatusSchema,
    createSupportSchema,
};
