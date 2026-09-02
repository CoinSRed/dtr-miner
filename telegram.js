const crypto = require("crypto");

function verifyTelegramInitData(initData) {
    if (!initData || typeof initData !== "string") {
        throw new Error("Missing Telegram initData");
    }

    const botToken = process.env.BOT_TOKEN;

    if (!botToken) {
        throw new Error("BOT_TOKEN is not configured");
    }

    const params = new URLSearchParams(initData);

    const receivedHash = params.get("hash");

    if (!receivedHash) {
        throw new Error("Telegram hash is missing");
    }

    // Remove hash before creating the data-check-string
    params.delete("hash");

    const dataCheckString = [...params.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");

    // Telegram Web Apps secret key
    const secretKey = crypto
        .createHmac("sha256", "WebAppData")
        .update(botToken)
        .digest();

    // Calculate Telegram hash
    const calculatedHash = crypto
        .createHmac("sha256", secretKey)
        .update(dataCheckString)
        .digest("hex");

    // Timing-safe comparison
    const receivedBuffer = Buffer.from(receivedHash, "hex");
    const calculatedBuffer = Buffer.from(calculatedHash, "hex");

    if (
        receivedBuffer.length !== calculatedBuffer.length ||
        !crypto.timingSafeEqual(receivedBuffer, calculatedBuffer)
    ) {
        throw new Error("Invalid Telegram initData");
    }

    // Check auth_date
    const authDate = Number(params.get("auth_date"));

    if (!Number.isFinite(authDate)) {
        throw new Error("Invalid Telegram auth_date");
    }

    const now = Math.floor(Date.now() / 1000);

    // Reject data older than 24 hours
    const maxAge = 24 * 60 * 60;

    if (now - authDate > maxAge) {
        throw new Error("Telegram initData expired");
    }

    // Reject impossible future timestamps
    if (authDate > now + 60) {
        throw new Error("Invalid Telegram auth_date");
    }

    // Get Telegram user
    const userRaw = params.get("user");

    if (!userRaw) {
        throw new Error("Telegram user data is missing");
    }

    let user;

    try {
        user = JSON.parse(userRaw);
    } catch {
        throw new Error("Invalid Telegram user data");
    }

    if (!user.id) {
        throw new Error("Telegram user ID is missing");
    }

    return user;
}

module.exports = {
    verifyTelegramInitData
};