/**
 * utils/email.js
 * Server-side email helper (Gmail SMTP via nodemailer).
 *
 * All public functions are non-blocking and swallow their own errors: a failed
 * email must never break the HTTP request that triggered it. Call them
 * fire-and-forget (no await needed) from routes.
 */

const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const APP_URL = process.env.APP_URL || 'https://rm-tawssil.ma';
const FROM = process.env.SMTP_FROM || `Rm Tawssil <${process.env.SMTP_USER || 'rmtawssil@gmail.com'}>`;

// Lazily-created singleton transporter (reused across requests).
let transporter = null;
function getTransporter() {
    if (transporter) return transporter;
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.warn('[Email] SMTP_USER / SMTP_PASS not set — emails are disabled.');
        return null;
    }
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT || 465),
        secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : true,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
    return transporter;
}

/**
 * Low-level send. Resolves to true on success, false otherwise (never throws).
 * @param {{to?: string, bcc?: string|string[], subject: string, html: string, text?: string}} opts
 */
async function sendMail({ to, bcc, subject, html, text }) {
    const tx = getTransporter();
    if (!tx) return false;
    if (!to && !bcc) return false;
    try {
        await tx.sendMail({
            from: FROM,
            to,
            bcc,
            subject,
            html,
            text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        });
        return true;
    } catch (err) {
        console.error('[Email] send failed:', err.message);
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────
// Branded French layout
// ─────────────────────────────────────────────────────────────────────
function layout({ title, intro, bodyHtml = '', ctaLabel = 'Ouvrir Rm Tawssil', ctaUrl = APP_URL }) {
    return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
        <tr><td style="background:#1E40AF;padding:24px 32px;">
          <span style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:.3px;">Rm Tawssil</span>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">${title}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${intro}</p>
          ${bodyHtml}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
            <tr><td style="border-radius:8px;background:#1E40AF;">
              <a href="${ctaUrl}" target="_blank"
                 style="display:inline-block;padding:12px 26px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">
                ${ctaLabel}
              </a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">
            Cet email vous a été envoyé par Rm Tawssil — plateforme de transport collaboratif.<br/>
            <a href="${APP_URL}" style="color:#64748b;">${APP_URL.replace(/^https?:\/\//, '')}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** Small detail box (key/value rows). */
function detailBox(rows) {
    const trs = rows
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) =>
            `<tr>
               <td style="padding:6px 0;font-size:13px;color:#64748b;width:42%;">${k}</td>
               <td style="padding:6px 0;font-size:13px;color:#0f172a;font-weight:bold;">${v}</td>
             </tr>`)
        .join('');
    return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
              style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;">
              ${trs}
            </table>`;
}

const esc = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// ─────────────────────────────────────────────────────────────────────
// 1) Welcome email (account created) — client or transporter
// ─────────────────────────────────────────────────────────────────────
function sendWelcomeEmail(user) {
    if (!user || !user.email) return;
    const isTransporter = user.role === 'transporter';
    const title = `Bienvenue sur Rm Tawssil, ${esc(user.name)} !`;
    const intro = isTransporter
        ? "Votre compte transporteur a bien été créé. Il est en cours de vérification par notre équipe — vous recevrez une confirmation dès qu'il sera validé."
        : "Votre compte a bien été créé. Vous pouvez dès maintenant publier vos colis et trouver des transporteurs de confiance.";
    const bodyHtml = isTransporter
        ? `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#334155;">En attendant la validation, vous pouvez compléter votre profil et vos trajets.</p>`
        : `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#334155;">Publiez votre premier colis en quelques secondes.</p>`;
    const html = layout({ title, intro, bodyHtml, ctaLabel: 'Accéder à mon compte' });
    sendMail({ to: user.email, subject: 'Bienvenue sur Rm Tawssil 🚚', html });
}

// ─────────────────────────────────────────────────────────────────────
// 2) Voyage created — confirmation to transporter + broadcast to all clients
// ─────────────────────────────────────────────────────────────────────
function voyageLabel(v) {
    const from = [v.from_city, v.from_country].filter(Boolean).join(', ');
    const to = [v.to_city, v.to_country].filter(Boolean).join(', ');
    return `${from} → ${to}`;
}

function fmtDate(d) {
    if (!d) return null;
    try {
        return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    } catch {
        return String(d);
    }
}

/**
 * @param {object} db        mysql2 pool
 * @param {object} transporter  { name, email }
 * @param {object} voyage    { from_country, from_city, to_country, to_city, departure_date, estimated_arrival, price_per_kg, available_capacity }
 */
async function sendVoyageCreatedEmails(db, transporter, voyage) {
    const route = voyageLabel(voyage);
    const details = detailBox([
        ['Trajet', esc(route)],
        ['Départ', fmtDate(voyage.departure_date)],
        ['Arrivée estimée', fmtDate(voyage.estimated_arrival)],
        ['Prix/kg', voyage.price_per_kg ? `${esc(voyage.price_per_kg)} MAD` : null],
        ['Capacité', voyage.available_capacity ? `${esc(voyage.available_capacity)} kg` : null],
    ]);

    // 2a) Confirmation to the transporter
    if (transporter && transporter.email) {
        const html = layout({
            title: 'Votre voyage a été publié ✅',
            intro: `Votre voyage <strong>${esc(route)}</strong> est désormais visible par les clients.`,
            bodyHtml: details,
            ctaLabel: 'Voir mes voyages',
        });
        sendMail({ to: transporter.email, subject: `Voyage publié : ${route}`, html });
    }

    // 2b) Broadcast to all active clients (BCC batches to respect privacy + limits)
    try {
        const [clients] = await db.query(
            "SELECT email FROM users WHERE role = 'client' AND status = 'active' AND email IS NOT NULL AND email <> ''"
        );
        const emails = clients.map((c) => c.email).filter(Boolean);
        if (emails.length === 0) return;

        const html = layout({
            title: 'Nouveau voyage disponible 🚚',
            intro: `Un transporteur vient de publier un nouveau voyage <strong>${esc(route)}</strong>. Réservez votre place dès maintenant.`,
            bodyHtml: details,
            ctaLabel: 'Voir le voyage',
        });

        const BATCH = 50; // Gmail counts recipients; keep batches modest
        for (let i = 0; i < emails.length; i += BATCH) {
            const batch = emails.slice(i, i + BATCH);
            // eslint-disable-next-line no-await-in-loop
            await sendMail({ bcc: batch, subject: `Nouveau voyage : ${route}`, html });
        }
        console.log(`[Email] Voyage broadcast sent to ${emails.length} client(s).`);
    } catch (err) {
        console.error('[Email] Voyage broadcast failed:', err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────
// 3) Chat emails — first message of a conversation + throttled unread reminder
// ─────────────────────────────────────────────────────────────────────
// In-memory throttle so an active back-and-forth doesn't trigger one email per
// message. Keyed by `${recipientId}:${deliveryId}`.
const lastChatEmailAt = new Map();
const CHAT_EMAIL_THROTTLE_MS = 30 * 60 * 1000; // 30 minutes

function chatEmailHtml(recipientName, senderName, isFirst) {
    const title = isFirst ? 'Nouvelle conversation 💬' : 'Vous avez un message non lu 💬';
    const intro = isFirst
        ? `Bonjour ${esc(recipientName)}, <strong>${esc(senderName)}</strong> a démarré une conversation avec vous sur Rm Tawssil.`
        : `Bonjour ${esc(recipientName)}, vous avez un message non lu de <strong>${esc(senderName)}</strong>.`;
    return layout({
        title,
        intro,
        bodyHtml: `<p style="margin:0;font-size:14px;line-height:1.6;color:#334155;">Ouvrez l'application pour répondre.</p>`,
        ctaLabel: 'Ouvrir la conversation',
    });
}

/**
 * Decide and send the right chat email. Non-blocking.
 * @param {object} recipient  { id, name, email }
 * @param {string} senderName
 * @param {string} deliveryId
 * @param {boolean} isFirstMessage  true if this is the very first message in the conversation
 */
function sendChatEmail(recipient, senderName, deliveryId, isFirstMessage) {
    if (!recipient || !recipient.email) return;

    if (!isFirstMessage) {
        // Throttle reminders for subsequent messages.
        const key = `${recipient.id}:${deliveryId}`;
        const last = lastChatEmailAt.get(key) || 0;
        if (Date.now() - last < CHAT_EMAIL_THROTTLE_MS) return;
        lastChatEmailAt.set(key, Date.now());
    } else {
        lastChatEmailAt.set(`${recipient.id}:${deliveryId}`, Date.now());
    }

    const html = chatEmailHtml(recipient.name, senderName, isFirstMessage);
    const subject = isFirstMessage
        ? `${senderName} vous a contacté sur Rm Tawssil`
        : `Message non lu de ${senderName}`;
    sendMail({ to: recipient.email, subject, html });
}

module.exports = {
    sendMail,
    sendWelcomeEmail,
    sendVoyageCreatedEmails,
    sendChatEmail,
};
