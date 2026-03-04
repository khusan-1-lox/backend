const crypto = require('crypto');

/**
 * Validates the data received from the Telegram Mini App.
 * @param {string} initData - The raw initData string from window.Telegram.WebApp.initData
 * @param {string} botToken - Your Telegram Bot Token
 * @returns {object|boolean} - The parsed data object if valid, otherwise false
 */
function validateInitData(initData, botToken) {
    if (!initData || !botToken) return false;

    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');

    // Sort parameters alphabetically
    const params = Array.from(urlParams.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

    // Create secret key using bot token
    const secretKey = crypto
        .createHmac('sha256', 'WebAppData')
        .update(botToken)
        .digest();

    // Calculate hash
    const calculatedHash = crypto
        .createHmac('sha256', secretKey)
        .update(params)
        .digest('hex');

    if (calculatedHash === hash) {
        // Parse the 'user' field if it exists
        const data = Object.fromEntries(urlParams.entries());
        if (data.user) {
            try {
                data.user = JSON.parse(data.user);
            } catch (e) {
                console.error("Failed to parse user data", e);
            }
        }
        return data;
    }

    return false;
}

module.exports = { validateInitData };
