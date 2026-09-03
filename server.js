const express = require("express");
const path = require("path");

const { query, testDatabase } = require("./db");
const { verifyTelegramInitData } = require("./telegram");

const app = express();

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

const MIN_WITHDRAWAL = 100;
const REFERRAL_REWARD = 100;

function authMiddleware(req, res, next) {
    try {
        const initData = req.headers["x-telegram-init-data"];

        if (!initData) {
            return res.status(401).json({
                error: "Telegram authentication required"
            });
        }

        const telegramUser = verifyTelegramInitData(initData);
        req.telegramUser = telegramUser;
        next();

    } catch (error) {
        console.error("Auth error:", error.message);
        return res.status(401).json({
            error: "Invalid Telegram authentication"
        });
    }
}

async function getOrCreateUser(telegramUser) {
    const telegramId = String(telegramUser.id);

    const existing = await query(
        `SELECT * FROM users WHERE telegram_id = $1`,
        [telegramId]
    );

    if (existing.rows.length > 0) {
        const updated = await query(
            `
            UPDATE users
            SET username = $2, first_name = $3, updated_at = NOW()
            WHERE telegram_id = $1
            RETURNING *
            `,
            [
                telegramId,
                telegramUser.username || null,
                telegramUser.first_name || "DTR User"
            ]
        );
        return updated.rows[0];
    }

    const created = await query(
        `
        INSERT INTO users (telegram_id, username, first_name)
        VALUES ($1, $2, $3)
        RETURNING *
        `,
        [
            telegramId,
            telegramUser.username || null,
            telegramUser.first_name || "DTR User"
        ]
    );

    return created.rows[0];
}

async function calculateMining(user) {
    if (!user.mining_active || !user.mining_started_at) {
        return user;
    }

    const miner = await query(
        `SELECT rate_per_hour FROM miners WHERE level = $1`,
        [user.miner_level]
    );

    if (miner.rows.length === 0) {
        return user;
    }

    const ratePerHour = Number(miner.rows[0].rate_per_hour);
    const startedAt = new Date(user.mining_started_at).getTime();
    const now = Date.now();
    const elapsedSeconds = Math.max(0, (now - startedAt) / 1000);
    const earned = (ratePerHour / 3600) * elapsedSeconds;

    if (earned <= 0) {
        return user;
    }

    const updated = await query(
        `
        UPDATE users
        SET balance = balance + $2, total_mined = total_mined + $2, mining_started_at = NOW(), updated_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        [user.id, earned]
    );

    return updated.rows[0];
}

app.get("/api/me", authMiddleware, async (req, res) => {
    try {
        let user = await getOrCreateUser(req.telegramUser);
        user = await calculateMining(user);

        const miner = await query(
            `SELECT level, name, rate_per_hour, price FROM miners WHERE level = $1`,
            [user.miner_level]
        );

        res.json({
            user: {
                id: user.id,
                telegram_id: user.telegram_id,
                username: user.username,
                first_name: user.first_name,
                balance: user.balance,
                total_mined: user.total_mined,
                miner_level: user.miner_level,
                referrals_count: user.referrals_count,
                mining_active: user.mining_active,
                mining_started_at: user.mining_started_at
            },
            miner: miner.rows[0] || null
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post("/api/mining/start", authMiddleware, async (req, res) => {
    try {
        const user = await getOrCreateUser(req.telegramUser);
        const updated = await calculateMining(user);

        if (updated.mining_active) {
            return res.json({
                success: true,
                mining_active: true,
                message: "Mining already active"
            });
        }

        const result = await query(
            `
            UPDATE users
            SET mining_active = TRUE, mining_started_at = NOW(), updated_at = NOW()
            WHERE id = $1
            RETURNING *
            `,
            [updated.id]
        );

        res.json({
            success: true,
            mining_active: true,
            mining_started_at: result.rows[0].mining_started_at
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to start mining" });
    }
});

app.post("/api/mining/claim", authMiddleware, async (req, res) => {
    try {
        const user = await getOrCreateUser(req.telegramUser);
        let updated = await calculateMining(user);

        if (!updated.mining_active) {
            return res.json({
                success: true,
                balance: updated.balance,
                total_mined: updated.total_mined,
                mining_active: false
            });
        }

        const result = await query(
            `
            UPDATE users
            SET mining_active = FALSE, mining_started_at = NULL, updated_at = NOW()
            WHERE id = $1
            RETURNING *
            `,
            [updated.id]
        );

        updated = result.rows[0];

        res.json({
            success: true,
            balance: updated.balance,
            total_mined: updated.total_mined,
            mining_active: false
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to claim mining" });
    }
});

app.get("/api/miners", authMiddleware, async (req, res) => {
    try {
        const result = await query(
            `SELECT level, name, rate_per_hour, price FROM miners ORDER BY level ASC`
        );
        res.json({ miners: result.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to load miners" });
    }
});

app.post("/api/miners/buy", authMiddleware, async (req, res) => {
    const clientUser = await getOrCreateUser(req.telegramUser);
    const minerLevel = Number(req.body.miner_level);

    if (!Number.isInteger(minerLevel)) {
        return res.status(400).json({ error: "Invalid miner level" });
    }

    const client = require("./db").pool;
    const connection = await client.connect();

    try {
        await connection.query("BEGIN");

        const userResult = await connection.query(
            `SELECT * FROM users WHERE id = $1 FOR UPDATE`,
            [clientUser.id]
        );
        const user = userResult.rows[0];

        const minerResult = await connection.query(
            `SELECT * FROM miners WHERE level = $1`,
            [minerLevel]
        );

        if (minerResult.rows.length === 0) {
            await connection.query("ROLLBACK");
            return res.status(404).json({ error: "Miner not found" });
        }

        const miner = minerResult.rows[0];

        if (minerLevel <= user.miner_level) {
            await connection.query("ROLLBACK");
            return res.status(400).json({ error: "Miner level is not higher" });
        }

        const price = Number(miner.price);

        if (Number(user.balance) < price) {
            await connection.query("ROLLBACK");
            return res.status(400).json({ error: "Insufficient DTR" });
        }

        const updated = await connection.query(
            `
            UPDATE users
            SET balance = balance - $2, miner_level = $3, updated_at = NOW()
            WHERE id = $1
            RETURNING *
            `,
            [user.id, price, minerLevel]
        );

        await connection.query("COMMIT");

        res.json({
            success: true,
            balance: updated.rows[0].balance,
            miner_level: updated.rows[0].miner_level
        });

    } catch (error) {
        await connection.query("ROLLBACK");
        console.error(error);
        res.status(500).json({ error: "Unable to buy miner" });
    } finally {
        connection.release();
    }
});

app.get("/api/tasks", authMiddleware, async (req, res) => {
    try {
        const user = await getOrCreateUser(req.telegramUser);
        const result = await query(
            `
            SELECT t.id, t.task_key, t.title, t.reward, t.active, ut.completed_at
            FROM tasks t
            LEFT JOIN user_tasks ut ON ut.task_id = t.id AND ut.user_id = $1
            WHERE t.active = TRUE
            ORDER BY t.id ASC
            `,
            [user.id]
        );

        res.json({ tasks: result.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to load tasks" });
    }
});

app.post("/api/tasks/claim", authMiddleware, async (req, res) => {
    const taskId = Number(req.body.task_id);

    if (!Number.isInteger(taskId)) {
        return res.status(400).json({ error: "Invalid task ID" });
    }

    const pool = require("./db").pool;
    const connection = await pool.connect();

    try {
        await connection.query("BEGIN");

        const user = await getOrCreateUser(req.telegramUser);
        const taskResult = await connection.query(
            `SELECT * FROM tasks WHERE id = $1 AND active = TRUE`,
            [taskId]
        );

        if (taskResult.rows.length === 0) {
            await connection.query("ROLLBACK");
            return res.status(404).json({ error: "Task not found" });
        }

        const task = taskResult.rows[0];

        const completed = await connection.query(
            `SELECT id FROM user_tasks WHERE user_id = $1 AND task_id = $2`,
            [user.id, taskId]
        );

        if (completed.rows.length > 0) {
            await connection.query("ROLLBACK");
            return res.status(400).json({ error: "Task already completed" });
        }

        await connection.query(
            `INSERT INTO user_tasks (user_id, task_id) VALUES ($1, $2)`,
            [user.id, taskId]
        );

        await connection.query(
            `
            UPDATE users
            SET balance = balance + $2, total_mined = total_mined + $2, updated_at = NOW()
            WHERE id = $1
            `,
            [user.id, task.reward]
        );

        await connection.query("COMMIT");

        const updated = await connection.query(
            `SELECT balance, total_mined FROM users WHERE id = $1`,
            [user.id]
        );

        res.json({
            success: true,
            reward: task.reward,
            balance: updated.rows[0].balance,
            total_mined: updated.rows[0].total_mined
        });

    } catch (error) {
        await connection.query("ROLLBACK");
        console.error(error);
        res.status(500).json({ error: "Unable to claim task" });
    } finally {
        connection.release();
    }
});

app.post("/api/referrals", authMiddleware, async (req, res) => {
    const referralCode = String(req.body.referral_code || "").trim();

    if (!referralCode) {
        return res.status(400).json({ error: "Referral code required" });
    }

    const inviterTelegramId = referralCode.replace(/^ref_/, "");

    if (!/^\d+$/.test(inviterTelegramId)) {
        return res.status(400).json({ error: "Invalid referral code" });
    }

    const pool = require("./db").pool;
    const connection = await pool.connect();

    try {
        await connection.query("BEGIN");

        const invitedUser = await getOrCreateUser(req.telegramUser);

        if (String(invitedUser.telegram_id) === inviterTelegramId) {
            await connection.query("ROLLBACK");
            return res.status(400).json({ error: "You cannot refer yourself" });
        }

        const inviterResult = await connection.query(
            `SELECT * FROM users WHERE telegram_id = $1 FOR UPDATE`,
            [inviterTelegramId]
        );

        if (inviterResult.rows.length === 0) {
            await connection.query("ROLLBACK");
            return res.status(404).json({ error: "Inviter not found" });
        }

        const inviter = inviterResult.rows[0];

        const existing = await connection.query(
            `SELECT id FROM referrals WHERE invited_id = $1`,
            [invitedUser.id]
        );

        if (existing.rows.length > 0) {
            await connection.query("ROLLBACK");
            return res.status(400).json({ error: "Referral already assigned" });
        }

        await connection.query(
            `INSERT INTO referrals (inviter_id, invited_id, reward) VALUES ($1, $2, $3)`,
            [inviter.id, invitedUser.id, REFERRAL_REWARD]
        );

        await connection.query(
            `
            UPDATE users
            SET balance = balance + $2, total_mined = total_mined + $2, referrals_count = referrals_count + 1, updated_at = NOW()
            WHERE id = $1
            `,
            [inviter.id, REFERRAL_REWARD]
        );

        await connection.query("COMMIT");

        res.json({ success: true, message: "Referral registered" });

    } catch (error) {
        await connection.query("ROLLBACK");

        if (error.code === "23505") {
            return res.status(400).json({ error: "Referral already exists" });
        }

        console.error(error);
        res.status(500).json({ error: "Unable to register referral" });
    } finally {
        connection.release();
    }
});

app.post("/api/withdraw", authMiddleware, async (req, res) => {
    const amount = Number(req.body.amount);
    const walletAddress = String(req.body.wallet_address || "").trim();

    if (!Number.isFinite(amount) || amount < MIN_WITHDRAWAL) {
        return res.status(400).json({ error: `Minimum withdrawal is ${MIN_WITHDRAWAL} DTR` });
    }

    if (!walletAddress) {
        return res.status(400).json({ error: "Wallet address required" });
    }

    const pool = require("./db").pool;
    const connection = await pool.connect();

    try {
        await connection.query("BEGIN");

        const clientUser = await getOrCreateUser(req.telegramUser);
        const userResult = await connection.query(
            `SELECT * FROM users WHERE id = $1 FOR UPDATE`,
            [clientUser.id]
        );
        const user = userResult.rows[0];

        if (Number(user.balance) < amount) {
            await connection.query("ROLLBACK");
            return res.status(400).json({ error: "Insufficient balance" });
        }

        await connection.query(
            `UPDATE users SET balance = balance - $2, updated_at = NOW() WHERE id = $1`,
            [user.id, amount]
        );

        const withdrawResult = await connection.query(
            `
            INSERT INTO withdrawals (user_id, amount, wallet_address, status)
            VALUES ($1, $2, $3, 'pending')
            RETURNING *
            `,
            [user.id, amount, walletAddress]
        );

        await connection.query("COMMIT");

        res.json({
            success: true,
            withdrawal: withdrawResult.rows[0]
        });

    } catch (error) {
        await connection.query("ROLLBACK");
        console.error(error);
        res.status(500).json({ error: "Unable to process withdrawal" });
    } finally {
        connection.release();
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
