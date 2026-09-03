const express = require("express");
const { pool, query } = require("./db");
const { verifyTelegramInitData } = require("./telegram");

const app = express();
const PORT = process.env.PORT || 3000;

const MIN_WITHDRAWAL = 5;
const REFERRAL_REWARD = 100;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* =========================
   TELEGRAM AUTH
========================= */

function authMiddleware(req, res, next) {
    try {
        const initData = req.headers["x-telegram-init-data"];

        if (!initData) {
            return res.status(401).json({
                error: "Telegram authentication required"
            });
        }

        const user = verifyTelegramInitData(initData);

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
    const telegramId = String(telegramUser.id);

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

    const username = telegramUser.username || null;
    const firstName = telegramUser.first_name || "DTR User";

    result = await query(
        `
        INSERT INTO users
        (
            telegram_id,
            username,
            first_name
        )
        VALUES ($1, $2, $3)
        RETURNING *
        `,
        [
            telegramId,
            username,
            firstName
        ]
    );

    return result.rows[0];
}


/* =========================
   MINING CALCULATION
========================= */

function calculateMining(user, miningRate) {

    if (
        !user.mining_active ||
        !user.mining_started_at
    ) {
        return {
            earned: 0,
            elapsedSeconds: 0
        };
    }

    const started =
        new Date(user.mining_started_at).getTime();

    const now = Date.now();

    const elapsedSeconds =
        Math.max(
            0,
            (now - started) / 1000
        );

    const rate =
        Number(miningRate || 0);

    const earned =
        elapsedSeconds * (rate / 3600);

    return {
        earned,
        elapsedSeconds
    };
}


/* =========================
   GET CURRENT MINER
========================= */

async function getUserMiner(user) {

    const level =
        Number(user.miner_level || 1);

    const result =
        await query(
            `
            SELECT
                level,
                name,
                rate_per_hour,
                price
            FROM miners
            WHERE level = $1
            LIMIT 1
            `,
            [level]
        );

    if (result.rows.length === 0) {
        return null;
    }

    return result.rows[0];
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

            const miner =
                await getUserMiner(user);

            const mining =
                calculateMining(user, Number(miner.rate_per_hour));

            const rate =
                miner
                    ? Number(miner.rate_per_hour)
                    : 0;

            res.json({
                success: true,

                user: {
                    id: user.id,

                    telegram_id:
                        user.telegram_id,

                    username:
                        user.username,

                    first_name:
                        user.first_name,

                    last_name:
                        null,

                    balance:
                        Number(user.balance || 0),

                    total_mined:
                        Number(user.total_mined || 0),

                    miner_level:
                        Number(user.miner_level || 1),

                    referrals_count:
                        Number(user.referrals_count || 0),

                    mining_active:
                        Boolean(user.mining_active),

                    mining_started_at:
                        user.mining_started_at,

                    mining_rate:
                        rate,

                    earned:
                        mining.earned
                },

                miner: miner
                    ? {
                        level:
                            Number(miner.level),

                        name:
                            miner.name,

                        rate_per_hour:
                            Number(
                                miner.rate_per_hour
                            ),

                        price:
                            Number(miner.price)
                    }
                    : null
            });

        } catch (error) {

            console.error(
                "GET /api/me error:",
                error
            );

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

            if (user.mining_active) {

                return res.json({
                    success: true,

                    message:
                        "Mining already started",

                    mining_active: true,

                    mining_started_at:
                        user.mining_started_at,

                    mining_rate:
                        Number(
                            miner.rate_per_hour || 0
                        )
                });
            }

            const miner =
                await getUserMiner(user);

            const miningRate =
                miner
                    ? Number(miner.rate_per_hour)
                    : 0.20;

            const result =
                await query(
                    `
                    UPDATE users
                    SET
                        mining_active = TRUE,
                        mining_started_at = NOW(),
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING *
                    `,
                    [user.id]
                );

            res.json({
                success: true,

                mining_active: true,

                mining_started_at:
                    result.rows[0].mining_started_at,

                mining_rate:
                    miningRate
            });

        } catch (error) {

            console.error(
                "START MINING error:",
                error
            );

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

                await connection.query(
                    "ROLLBACK"
                );

                return res.status(404).json({
                    error: "User not found"
                });
            }

            const user =
                userResult.rows[0];

            if (!user.mining_active) {

                await connection.query(
                    "ROLLBACK"
                );

                return res.json({
                    success: true,
                    earned: 0,
                    balance:
                        Number(
                            user.balance || 0
                        )
                });
            }

            const minerResult =
                await connection.query(
                    `
                    SELECT rate_per_hour
                    FROM miners
                    WHERE level = $1
                    LIMIT 1
                    `,
                    [user.miner_level]
                );

            if (minerResult.rows.length === 0) {
                await connection.query("ROLLBACK");
                return res.status(500).json({
                    error: "Miner not found"
                });
            }

            const miner =
                minerResult.rows[0];

            const mining =
                calculateMining(user, Number(miner.rate_per_hour));

            const earned =
                Number(
                    mining.earned.toFixed(8)
                );

            if (earned <= 0) {

                await connection.query(
                    "ROLLBACK"
                );

                return res.json({
                    success: true,
                    earned: 0,
                    balance:
                        Number(
                            user.balance || 0
                        )
                });
            }

            const updated =
                await connection.query(
                    `
                    UPDATE users
                    SET
                        balance = balance + $2,
                        total_mined = total_mined + $2,
                        mining_active = FALSE,
                        mining_started_at = NULL,
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
                    ),

                total_mined:
                    Number(
                        updated.rows[0].total_mined
                    ),

                mining_active: false
            });

        } catch (error) {

            await connection.query(
                "ROLLBACK"
            );

            console.error(
                "CLAIM MINING error:",
                error
            );

            res.status(500).json({
                error:
                    "Unable to claim mining"
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
                    SELECT
                        level,
                        name,
                        rate_per_hour,
                        price
                    FROM miners
                    ORDER BY level ASC
                    `
                );

            res.json({
                success: true,

                miners:
                    result.rows.map(
                        miner => ({
                            level:
                                Number(
                                    miner.level
                                ),

                            name:
                                miner.name,

                            rate_per_hour:
                                Number(
                                    miner.rate_per_hour
                                ),

                            price:
                                Number(
                                    miner.price
                                )
                        })
                    )
            });

        } catch (error) {

            console.error(
                "GET MINERS error:",
                error
            );

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

        const connection =
            await pool.connect();

        try {

            await connection.query("BEGIN");

            const minerLevel =
                Number(
                    req.body.miner_level
                );

            if (
                !Number.isInteger(minerLevel) ||
                minerLevel < 1
            ) {

                await connection.query(
                    "ROLLBACK"
                );

                return res.status(400).json({
                    error:
                        "Invalid miner level"
                });
            }

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

                await connection.query(
                    "ROLLBACK"
                );

                return res.status(404).json({
                    error: "User not found"
                });
            }

            const user =
                userResult.rows[0];

            const minerResult =
                await connection.query(
                    `
                    SELECT *
                    FROM miners
                    WHERE level = $1
                    LIMIT 1
                    `,
                    [minerLevel]
                );

            if (minerResult.rows.length === 0) {

                await connection.query(
                    "ROLLBACK"
                );

                return res.status(404).json({
                    error: "Miner not found"
                });
            }

            const miner =
                minerResult.rows[0];

            const price =
                Number(miner.price);

            const currentLevel =
                Number(
                    user.miner_level || 1
                );

            if (
                minerLevel <= currentLevel
            ) {

                await connection.query(
                    "ROLLBACK"
                );

                return res.status(400).json({
                    error:
                        "You already own this miner or a higher level"
                });
            }

            if (
                Number(user.balance) < price
            ) {

                await connection.query(
                    "ROLLBACK"
                );

                return res.status(400).json({
                    error:
                        "Insufficient balance"
                });
            }

            const updated =
                await connection.query(
                    `
                    UPDATE users
                    SET
                        balance = balance - $2,
                        miner_level = $3,
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING *
                    `,
                    [
                        user.id,
                        price,
                        minerLevel
                    ]
                );

            await connection.query("COMMIT");

            res.json({
                success: true,

                balance:
                    Number(
                        updated.rows[0].balance
                    ),

                miner_level:
                    Number(
                        updated.rows[0].miner_level
                    ),

                mining_rate:
                    Number(
                        miner.rate_per_hour
                    )
            });

        } catch (error) {

            await connection.query(
                "ROLLBACK"
            );

            console.error(
                "BUY MINER error:",
                error
            );

            res.status(500).json({
                error:
                    "Unable to buy miner"
            });

        } finally {

            connection.release();
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

            const user =
                await getOrCreateUser(
                    req.telegramUser
                );

            const result =
                await query(
                    `
                    SELECT
                        t.id,
                        t.task_key,
                        t.title,
                        t.reward,
                        t.active,
                        CASE
                            WHEN ut.id IS NOT NULL
                            THEN TRUE
                            ELSE FALSE
                        END AS completed
                    FROM tasks t
                    LEFT JOIN user_tasks ut
                        ON ut.task_id = t.id
                        AND ut.user_id = $1
                    WHERE t.active = TRUE
                    ORDER BY t.id ASC
                    `,
                    [user.id]
                );

            res.json({
                success: true,

                tasks:
                    result.rows.map(
                        task => ({
                            id:
                                Number(task.id),

                            task_key:
                                task.task_key,

                            title:
                                task.title,

                            reward:
                                Number(
                                    task.reward
                                ),

                            active:
                                task.active,

                            completed:
                                Boolean(
                                    task.completed
                                )
                        })
                    )
            });

        } catch (error) {

            console.error(
                "GET TASKS error:",
                error
            );

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

            if (
                !Number.isInteger(taskId)
            ) {

                await connection.query(
                    "ROLLBACK"
                );

                return res.status(400).json({
                    error:
                        "Invalid task ID"
                });
            }

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

                await connection.query(
                    "ROLLBACK"
                );

                return res.status(404).json({
                    error: "User not found"
                });
            }

            const user =
                userResult.rows[0];

            const taskResult =
                await connection.query(
                    `
                    SELECT *
                    FROM tasks
                    WHERE id = $1
                      AND active = TRUE
                    LIMIT 1
                    `,
                    [taskId]
                );

            if (taskResult.rows.length === 0) {

                await connection.query(
                    "ROLLBACK"
                );

                return res.status(404).json({
                    error: "Task not found"
                });
            }

            const task =
                taskResult.rows[0];

            const existing =
                await connection.query(
                    `
                    SELECT id
                    FROM user_tasks
                    WHERE user_id = $1
                      AND task_id = $2
                    LIMIT 1
                    `,
                    [
                        user.id,
                        taskId
                    ]
                );

            if (
                existing.rows.length > 0
            ) {

                await connection.query(
                    "ROLLBACK"
                );

                return res.status(400).json({
                    error:
                        "Task already completed"
                });
            }

            const reward =
                Number(task.reward);

            await connection.query(
                `
                INSERT INTO user_tasks
                (
                    user_id,
                    task_id,
                    completed_at
                )
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
                    SET
                        balance = balance + $2,
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

            await connection.query(
                "ROLLBACK"
            );

            console.error(
                "CLAIM TASK error:",
                error
            );

            res.status(500).json({
                error:
                    "Unable to claim task"
            });

        } finally {

            connection.release();
        }
    }
);

/* =========================
   GET REFERRALS
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
                    SELECT
                        COUNT(*) AS count,
                        COALESCE(
                            SUM(reward),
                            0
                        ) AS total_reward
                    FROM referrals
                    WHERE inviter_id = $1
                    `,
                    [user.id]
                );

            res.json({
                success: true,

                referrals:
                    Number(
                        result.rows[0].count || 0
                    ),

                total_reward:
                    Number(
                        result.rows[0].total_reward || 0
                    )
            });

        } catch (error) {

            console.error(
                "GET REFERRALS error:",
                error
            );

            res.status(500).json({
                error:
                    "Unable to get referrals"
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

        const connection =
            await pool.connect();

        try {

            await connection.query("BEGIN");

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

                await connection.query(
                    "ROLLBACK"
                );

                return res.status(400).json({
                    error:
                        "Invalid withdrawal amount"
                });
            }

            if (
                amount < MIN_WITHDRAWAL
            ) {

                await connection.query(
                    "ROLLBACK"
                );

                return res.status(400).json({
                    error:
                        `Minimum withdrawal is ${MIN_WITHDRAWAL} DTR`
                });
            }

            if (!walletAddress) {

                await connection.query(
                    "ROLLBACK"
                );

                return res.status(400).json({
                    error:
                        "Wallet address is required"
                });
            }

            if (
                walletAddress.length > 255
            ) {

                await connection.query(
                    "ROLLBACK"
                );

                return res.status(400).json({
                    error:
                        "Wallet address is too long"
                });
            }

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

            if (
                userResult.rows.length === 0
            ) {

                await connection.query(
                    "ROLLBACK"
                );

                return res.status(404).json({
                    error:
                        "User not found"
                });
            }

            const user =
                userResult.rows[0];

            const balance =
                Number(user.balance || 0);

            if (balance < amount) {

                await connection.query(
                    "ROLLBACK"
                );

                return res.status(400).json({
                    error:
                        "Insufficient balance"
                });
            }

            const updated =
                await connection.query(
                    `
                    UPDATE users
                    SET
                        balance = balance - $2,
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING *
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
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        'pending'
                    )
                    RETURNING
                        id,
                        amount,
                        wallet_address,
                        status,
                        created_at
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

                message:
                    "Withdrawal request submitted",

                withdrawal: {
                    id:
                        Number(
                            withdrawal.rows[0].id
                        ),

                    amount:
                        Number(
                            withdrawal.rows[0].amount
                        ),

                    wallet_address:
                        withdrawal.rows[0]
                            .wallet_address,

                    status:
                        withdrawal.rows[0]
                            .status,

                    created_at:
                        withdrawal.rows[0]
                            .created_at
                },

                balance:
                    Number(
                        updated.rows[0].balance
                    )
            });

        } catch (error) {

            await connection.query(
                "ROLLBACK"
            );

            console.error(
                "WITHDRAW error:",
                error
            );

            res.status(500).json({
                error:
                    "Unable to create withdrawal"
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
    "/health",
    async (req, res) => {

        try {

            const result =
                await query(
                    "SELECT NOW() AS time"
                );

            res.json({
                status: "ok",
                database: "connected",
                time:
                    result.rows[0].time
            });

        } catch (error) {

            console.error(
                "HEALTH error:",
                error
            );

            res.status(500).json({
                status: "error",
                database: "disconnected"
            });
        }
    }
);


/* =========================
   ROOT
========================= */

app.get(
    "/",
    (req, res) => {

        res.sendFile(
            require("path").join(
                __dirname,
                "public", "index.html"
            )
        );
    }
);


/* =========================
   404
========================= */

app.use(
    (req, res) => {

        res.status(404).json({
            error: "Route not found"
        });
    }
);


/* =========================
   ERROR HANDLER
========================= */

app.use(
    (error, req, res, next) => {

        console.error(
            "Unhandled server error:",
            error
        );

        res.status(500).json({
            error:
                "Internal server error"
        });
    }
);


/* =========================
   START SERVER
========================= */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `DTR Miner server running on port ${PORT}`
        );
    }
);
