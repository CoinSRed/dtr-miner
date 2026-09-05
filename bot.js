const TelegramBot = require("node-telegram-bot-api");
const { pool } = require("./db");

const token = process.env.BOT_TOKEN;

if (!token) {
  throw new Error("BOT_TOKEN is not configured");
}

const bot = new TelegramBot(token, { polling: true });

bot.onText(/^\/start(?:\s+(.+))?$/, async (msg, match) => {
  const telegramId = String(msg.from.id);
  const username = msg.from.username || null;
  const firstName = msg.from.first_name || "DTR User";
  const startParam = match?.[1] || "";

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `INSERT INTO users (telegram_id, username, first_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (telegram_id)
       DO UPDATE SET
         username = EXCLUDED.username,
         first_name = EXCLUDED.first_name,
         updated_at = NOW()
       RETURNING *`,
      [telegramId, username, firstName]
    );

    const invitedUser = userResult.rows[0];

    if (startParam.startsWith("ref_")) {
      const inviterTelegramId = startParam.slice(4);

      if (inviterTelegramId && inviterTelegramId !== telegramId) {
        const inviterResult = await client.query(
          `SELECT id
           FROM users
           WHERE telegram_id = $1
           LIMIT 1`,
          [inviterTelegramId]
        );

        if (inviterResult.rows.length > 0) {
          const inviterId = inviterResult.rows[0].id;

          const referralResult = await client.query(
            `INSERT INTO referrals (inviter_id, invited_id, reward)
             VALUES ($1, $2, 100)
             ON CONFLICT (invited_id) DO NOTHING
             RETURNING id`,
            [inviterId, invitedUser.id]
          );

          if (referralResult.rows.length > 0) {
            await client.query(
              `UPDATE users
               SET referrals_count = referrals_count + 1,
                   balance = balance + 100,
                   updated_at = NOW()
               WHERE id = $1`,
              [inviterId]
            );
          }
        }
      }
    }

    await client.query("COMMIT");

    await bot.sendMessage(
      msg.chat.id,
      "Welcome to DTR Miner! ⛏️"
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Referral/start error:", error);

    await bot.sendMessage(
      msg.chat.id,
      "Welcome to DTR Miner! ⛏️"
    );
  } finally {
    client.release();
  }
});

bot.on("polling_error", (error) => {
  console.error("Telegram polling error:", error.message);
});

console.log("DTR Telegram bot started");
