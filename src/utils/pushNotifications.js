/**
 * utils/pushNotifications.js
 * Server-side Expo Push Notification helper.
 * Sends push notifications to registered devices via the Expo Push API.
 */

const { Expo } = require('expo-server-sdk');

const expo = new Expo();

/**
 * Send a push notification to one or more users.
 * Silently ignores users without a push token.
 *
 * @param {string|string[]} pushTokens  - one or multiple Expo push tokens
 * @param {string} title
 * @param {string} body
 * @param {object} [data]               - extra payload for deep linking
 */
async function sendPushNotification(pushTokens, title, body, data = {}) {
    const tokens = Array.isArray(pushTokens) ? pushTokens : [pushTokens];

    const messages = tokens
        .filter((t) => t && Expo.isExpoPushToken(t))
        .map((to) => ({
            to,
            sound: 'default',
            title,
            body,
            data,
        }));

    if (messages.length === 0) return;

    try {
        const chunks = expo.chunkPushNotifications(messages);
        for (const chunk of chunks) {
            const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
            // Log errors but don't block the caller
            ticketChunk.forEach((ticket) => {
                if (ticket.status === 'error') {
                    console.warn('[Push] Error ticket:', ticket.message, ticket.details);
                }
            });
        }
    } catch (err) {
        console.error('[Push] Failed to send notification:', err.message);
    }
}

/**
 * Helper: fetch push tokens for given user IDs from the DB and send.
 * @param {object} db       - mysql2 pool
 * @param {string[]} userIds
 * @param {string} title
 * @param {string} body
 * @param {object} [data]
 */
async function notifyUsers(db, userIds, title, body, data = {}) {
    if (!userIds || userIds.length === 0) return;

    const placeholders = userIds.map(() => '?').join(',');
    const [rows] = await db.query(
        `SELECT push_token FROM users WHERE id IN (${placeholders}) AND push_token IS NOT NULL`,
        userIds
    );

    const tokens = rows.map((r) => r.push_token);
    await sendPushNotification(tokens, title, body, data);
}

module.exports = { sendPushNotification, notifyUsers };
