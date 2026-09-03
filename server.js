const express = require("express");
const { pool, query } = require("./db");
const { verifyTelegramInitData } = require("./telegram");

const app = express();

const PORT = process.env.PORT || 3000;

const MIN_WITHDRAWAL = 5;
const REFERRAL_REWARD = 0.0001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static("."));

/* =========================
   TELEGRAM AUTH
========================= */

function authMiddleware(req, res, next) {

    try {

        const initData =
            req.headers["x-telegram-init-data"];

        if (!initData) {
            return res.status(401).json({
                error: "Telegram authentication required"
            });
        }

        const user =
            verifyTelegramInitData(initData);

        req.telegramUser = user;

        next();

    } catch (error) {

        console.error("Auth error:", error);

        return res.status(401).json({
            error: "Invalid Telegram authentication"
        });
    }
}


/* =========================
   GET OR CREATE USER
========================= */

async function getOrCreateUser(telegramUser) {

    const telegramId =
        String(telegramUser.id);

    let result = await query(
        `
        SELECT *
        FROM users
        WHERE telegram_id = $1
        `,
        [telegramId]
    );

    if (result.rows.length > 0) {
        return result.rows[0];
    }

    const username =
        telegramUser.username || null;

    const firstName =
        telegramUser.first_name || "";

    const lastName =
        telegramUser.last_name || "";

    result = await query(
        `
        INSERT INTO users
        (
            telegram_id,
            username,
            first_name,
            last_name,
            balance
        )
        VALUES ($1, $2, $3, $4, 0)
        RETURNING *
        `,
        [
            telegramId,
            username,
            firstName,
            lastName
        ]
    );

    return result.rows[0];
}


/* =========================
   MINING CALCULATION
========================= */

function calculateMining(user) {

    if (!user.mining_started_at) {

        return {
            earned: 0,
            elapsedSeconds: 0
        };
    }

    const started =
        new Date(user.mining_started_at).getTime();

    const now =
        Date.now();

    const elapsedSeconds =
        Math.max(0, (now - started) / 1000);

    const rate =
        Number(user.mining_rate || 0);

    const earned =
        elapsedSeconds * (rate / 3600);

    return {
        earned,
        elapsedSeconds
    };
}


/* =========================
   GET USER
========================= */

app.get(
    "/api/me",
    authMiddleware,
    async (req, res) => {

        try {

            const user =
                await getOrCreateUser(
                    req.telegramUser
                );

            const mining =
                calculateMining(user);

            res.json({
                success: true,

                user: {
                    id: user.id,
                    telegram_id: user.telegram_id,
                    username: user.username,
                    first_name: user.first_name,
                    last_name: user.last_name,

                    balance: Number(user.balance || 0),

                    level: user.level || 1,

                    mining_started_at:
                        user.mining_started_at,

                    mining_rate:
                        Number(user.mining_rate || 0),

                    earned:
                        mining.earned
                }
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error: "Unable to get user"
            });
        }
    }
);


/* =========================
   START MINING
========================= */

app.post(
    "/api/mining/start",
    authMiddleware,
    async (req, res) => {

        try {

            const user =
                await getOrCreateUser(
                    req.telegramUser
                );

            if (user.mining_started_at) {

                return res.json({
                    success: true,
                    message: "Mining already started",
                    mining_started_at:
                        user.mining_started_at
                });
            }

            const miner =
                await query(
                    `
                    SELECT *
                    FROM miners
                    WHERE price = 0
                    ORDER BY id
                    LIMIT 1
                    `
                );

            let miningRate = 0.20;

            if (miner.rows.length > 0) {
                miningRate =
                    Number(miner.rows[0].rate_per_hour);
            }

            const result =
                await query(
                    `
                    UPDATE users
                    SET mining_started_at = NOW(),
                        mining_rate = $2,
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING *
                    `,
                    [
                        user.id,
                        miningRate
                    ]
                );

            res.json({
                success: true,

                mining_started_at:
                    result.rows[0].mining_started_at,

                mining_rate:
                    Number(result.rows[0].mining_rate)
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error: "Unable to start mining"
            });
        }
    }
);


/* =========================
   CLAIM MINING
========================= */

app.post(
    "/api/mining/claim",
    authMiddleware,
    async (req, res) => {

        const connection =
            await pool.connect();

        try {

            await connection.query("BEGIN");

            const telegramId =
                String(req.telegramUser.id);

            const userResult =
                await connection.query(
                    `
                    SELECT *
                    FROM users
                    WHERE telegram_id = $1
                    FOR UPDATE
                    `,
                    [telegramId]
                );

            if (userResult.rows.length === 0) {

                await connection.query("ROLLBACK");

                return res.status(404).json({
                    error: "User not found"
                });
            }

            const user =
                userResult.rows[0];

            const mining =
                calculateMining(user);

            const earned =
                Number(mining.earned);

            if (earned <= 0) {

                await connection.query("ROLLBACK");

                return res.json({
                    success: true,
                    earned: 0,
                    balance:
                        Number(user.balance || 0)
                });
            }

            const updated =
                await connection.query(
                    `
                    UPDATE users
                    SET balance = balance + $2,
                        mining_started_at = NOW(),
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING *
                    `,
                    [
                        user.id,
                        earned
                    ]
                );

            await connection.query("COMMIT");

            res.json({
                success: true,

                earned: earned,

                balance:
                    Number(
                        updated.rows[0].balance
                    )
            });

        } catch (error) {

            await connection.query("ROLLBACK");

            console.error(error);

            res.status(500).json({
                error: "Unable to claim mining"
            });

        } finally {

            connection.release();
        }
    }
);


/* =========================
   GET MINERS
========================= */

app.get(
    "/api/miners",
    authMiddleware,
    async (req, res) => {

        try {

            const result =
                await query(
                    `
                    SELECT *
                    FROM miners
                    ORDER BY price ASC
                    `
                );

            res.json({
                success: true,
                miners: result.rows
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error: "Unable to get miners"
            });
        }
    }
);


/* =========================
   BUY MINER
========================= */

app.post(
    "/api/miners/buy",
    authMiddleware,
    async (req, res) => {

        try {

            const minerLevel =
                Number(req.body.miner_level);

            if (!Number.isFinite(minerLevel)) {

                return res.status(400).json({
                    error: "Invalid miner level"
                });
            }

            const user =
                await getOrCreateUser(
                    req.telegramUser
                );

            const minerResult =
                await query(
                    `
                    SELECT *
                    FROM miners
                    WHERE id = $1
                    `,
                    [minerLevel]
                );

            if (minerResult.rows.length === 0) {

                return res.status(404).json({
                    error: "Miner not found"
                });
            }

            const miner =
                minerResult.rows[0];

            const price =
                Number(miner.price);

            if (Number(user.balance) < price) {

                return res.status(400).json({
                    error: "Insufficient balance"
                });
            }

            const result =
                await query(
                    `
                    UPDATE users
                    SET balance = balance - $2,
                        mining_rate = $3,
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING *
                    `,
                    [
                        user.id,
                        price,
                        Number(
                            miner.rate_per_hour
                        )
                    ]
                );

            res.json({
                success: true,

                balance:
                    Number(
                        result.rows[0].balance
                    ),

                mining_rate:
                    Number(
                        result.rows[0].mining_rate
                    )
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error: "Unable to buy miner"
            });
        }
    }
);


/* =========================
   GET TASKS
========================= */

app.get(
    "/api/tasks",
    authMiddleware,
    async (req, res) => {

        try {

            const result =
                await query(
                    `
                    SELECT *
                    FROM tasks
                    WHERE active = true
                    ORDER BY id ASC
                    `
                );

            res.json({
                success: true,
                tasks: result.rows
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error: "Unable to get tasks"
            });
        }
    }
);


/* =========================
   CLAIM TASK
========================= */

app.post(
    "/api/tasks/claim",
    authMiddleware,
    async (req, res) => {

        const connection =
            await pool.connect();

        try {

            await connection.query("BEGIN");

            const taskId =
                Number(req.body.task_id);

            if (!Number.isFinite(taskId)) {

                await connection.query("ROLLBACK");

                return res.status(400).json({
                    error: "Invalid task ID"
                });
            }

            const user =
                await getOrCreateUser(
                    req.telegramUser
                );

            const taskResult =
                await connection.query(
                    `
                    SELECT *
                    FROM tasks
                    WHERE id = $1
                      AND active = true
                    `,
                    [taskId]
                );

            if (taskResult.rows.length === 0) {

                await connection.query("ROLLBACK");

                return res.status(404).json({
                    error: "Task not found"
                });
            }

            const task =
                taskResult.rows[0];

            const existing =
                await connection.query(
                    `
                    SELECT *
                    FROM user_tasks
                    WHERE user_id = $1
                      AND task_id = $2
                    `,
                    [
                        user.id,
                        taskId
                    ]
                );

            if (existing.rows.length > 0) {

                await connection.query("ROLLBACK");

                return res.status(400).json({
                    error: "Task already completed"
                });
            }

            const reward =
                Number(task.reward);

            await connection.query(
                `
                INSERT INTO user_tasks
                (user_id, task_id, completed_at)
                VALUES ($1, $2, NOW())
                `,
                [
                    user.id,
                    taskId
                ]
            );

            const updated =
                await connection.query(
                    `
                    UPDATE users
                    SET balance = balance + $2,
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING *
                    `,
                    [
                        user.id,
                        reward
                    ]
                );

            await connection.query("COMMIT");

            res.json({
                success: true,

                reward: reward,

                balance:
                    Number(
                        updated.rows[0].balance
                    )
            });

        } catch (error) {

            await connection.query("ROLLBACK");

            console.error(error);

            res.status(500).json({
                error: "Unable to claim task"
            });

        } finally {

            connection.release();
        }
    }
);


/* =========================
   REFERRALS
========================= */

app.get(
    "/api/referrals",
    authMiddleware,
    async (req, res) => {

        try {

            const user =
                await getOrCreateUser(
                    req.telegramUser
                );

            const result =
                await query(
                    `
                    SELECT COUNT(*) AS count
                    FROM referrals
                    WHERE inviter_id = $1
                    `,
                    [user.id]
                );

            res.json({
                success: true,

                count:
                    Number(
                        result.rows[0].count
                    ),

                reward:
                    REFERRAL_REWARD
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error: "Unable to get referrals"
            });
        }
    }
);


/* =========================
   WITHDRAW
========================= */

app.post(
    "/api/withdraw",
    authMiddleware,
    async (req, res) => {

        const amount =
            Number(req.body.amount);

        const walletAddress =
            String(
                req.body.wallet_address || ""
            ).trim();

        if (
            !Number.isFinite(amount) ||
            amount <= 0
        ) {

            return res.status(400).json({
                error: "Invalid amount"
            });
        }

        if (amount < MIN_WITHDRAWAL) {

            return res.status(400).json({
                error:
                    `Minimum withdrawal is ${MIN_WITHDRAWAL} DTR`
            });
        }

        if (!walletAddress) {

            return res.status(400).json({
                error: "Wallet address is required"
            });
        }

        const connection =
            await pool.connect();

        try {

            await connection.query("BEGIN");

            const telegramId =
                String(req.telegramUser.id);

            const userResult =
                await connection.query(
                    `
                    SELECT *
                    FROM users
                    WHERE telegram_id = $1
                    FOR UPDATE
                    `,
                    [telegramId]
                );

            if (userResult.rows.length === 0) {

                await connection.query("ROLLBACK");

                return res.status(404).json({
                    error: "User not found"
                });
            }

            const user =
                userResult.rows[0];

            if (
                Number(user.balance) <
                amount
            ) {

                await connection.query("ROLLBACK");

                return res.status(400).json({
                    error: "Insufficient balance"
                });
            }

            await connection.query(
                `
                UPDATE users
                SET balance = balance - $2,
                    updated_at = NOW()
                WHERE id = $1
                `,
                [
                    user.id,
                    amount
                ]
            );

            const withdrawal =
                await connection.query(
                    `
                    INSERT INTO withdrawals
                    (
                        user_id,
                        amount,
                        wallet_address,
                        status
                    )
                    VALUES ($1, $2, $3, 'pending')
                    RETURNING *
                    `,
                    [
                        user.id,
                        amount,
                        walletAddress
                    ]
                );

            await connection.query("COMMIT");

            res.json({
                success: true,
                withdrawal:
                    withdrawal.rows[0]
            });

        } catch (error) {

            await connection.query("ROLLBACK");

            console.error(error);

            res.status(500).json({
                error:
                    "Unable to process withdrawal"
            });

        } finally {

            connection.release();
        }
    }
);


/* =========================
   HEALTH CHECK
========================= */

app.get(
    "/api/health",
    async (req, res) => {

        try {

            await query(
                "SELECT NOW()"
            );

            res.json({
                status: "ok",
                database: "connected"
            });

        } catch (error) {

            console.error(error);

                        res.status(500).json({
                status: "error",
                database: "disconnected"
            });
        }
    }
);


/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {

    console.log(
        `Server running on port ${PORT}`
    );

});
