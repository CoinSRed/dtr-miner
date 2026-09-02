const express = require("express");
const path = require("path");

const { query, pool, testDatabase } = require("./db");
const { verifyTelegramInitData } = require("./telegram");

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const MINING_DURATION_MS = 2 * 60 * 60 * 1000;

// =========================
// Middleware
// =========================

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));

// =========================
// Telegram Authentication
// =========================

function authMiddleware(req, res, next) {
    try {
        const initData = req.get("X-Telegram-Init-Data");

        const telegramUser =
            verifyTelegramInitData(initData);

        req.telegramUser = telegramUser;

        next();
    } catch (error) {
        return res.status(401).json({
            error: error.message || "Unauthorized"
        });
    }
}

// =========================
// User Functions
// =========================

async function getOrCreateUser(
    telegramUser,
    client = null
) {
    const db = client || { query };

    const existing = await db.query(
        `SELECT
            id,
            telegram_id,
            username,
            first_name,
            balance,
            total_mined,
            miner_level,
            referrals_count,
            mining_active,
            mining_started_at,
            created_at,
            updated_at
         FROM users
         WHERE telegram_id = $1`,
        [String(telegramUser.id)]
    );

    if (existing.rows.length > 0) {
        const user = existing.rows[0];

        const updated = await db.query(
            `UPDATE users
             SET
                username = $1,
                first_name = $2,
                updated_at = NOW()
             WHERE id = $3
             RETURNING
                id,
                telegram_id,
                username,
                first_name,
                balance,
                total_mined,
                miner_level,
                referrals_count,
                mining_active,
                mining_started_at,
                created_at,
                updated_at`,
            [
                telegramUser.username || null,
                telegramUser.first_name || "DTR User",
                user.id
            ]
        );

        return updated.rows[0];
    }

    const created = await db.query(
        `INSERT INTO users
            (
                telegram_id,
                username,
                first_name
            )
         VALUES
            ($1, $2, $3)
         RETURNING
            id,
            telegram_id,
            username,
            first_name,
            balance,
            total_mined,
            miner_level,
            referrals_count,
            mining_active,
            mining_started_at,
            created_at,
            updated_at`,
        [
            String(telegramUser.id),
            telegramUser.username || null,
            telegramUser.first_name || "DTR User"
        ]
    );

    return created.rows[0];
}

// =========================
// Mining Functions
// =========================

async function getMiningRate(
    client,
    minerLevel
) {
    const result = await client.query(
        `SELECT rate_per_hour
         FROM miners
         WHERE level = $1`,
        [minerLevel]
    );

    if (result.rows.length === 0) {
        throw new Error("Miner level not found");
    }

    return Number(
        result.rows[0].rate_per_hour
    );
}

function calculateMiningAmount(
    startedAt,
    ratePerHour,
    now = Date.now()
) {
    const start =
        new Date(startedAt).getTime();

    if (!Number.isFinite(start)) {
        return 0;
    }

    const elapsedMs = Math.max(
        0,
        Math.min(
            now - start,
            MINING_DURATION_MS
        )
    );

    return (
        (elapsedMs / 3600000) *
        ratePerHour
    );
}

function formatUser(user) {
    return {
        id: user.id,
        telegram_id: user.telegram_id,
        username: user.username,
        first_name: user.first_name,

        balance: Number(user.balance),
        total_mined: Number(user.total_mined),

        miner_level: user.miner_level,
        referrals_count: user.referrals_count,

        mining_active: user.mining_active,
        mining_started_at:
            user.mining_started_at
    };
}

// =========================
// Health
// =========================

app.get(
    "/health",
    async (req, res) => {
        try {
            const result =
                await testDatabase();

            return res.json({
                status: "ok",
                database: "connected",
                time: result.time
            });
        } catch (error) {
            console.error(
                "Health check error:",
                error
            );

            return res.status(500).json({
                status: "error",
                database: "disconnected"
            });
        }
    }
);

// =========================
// GET CURRENT USER
// =========================

app.get(
    "/api/me",
    authMiddleware,
    async (req, res) => {
        const client =
            await pool.connect();

        try {
            await client.query("BEGIN");

            let userResult =
                await client.query(
                    `SELECT
                        id,
                        telegram_id,
                        username,
                        first_name,
                        balance,
                        total_mined,
                        miner_level,
                        referrals_count,
                        mining_active,
                        mining_started_at,
                        created_at,
                        updated_at
                     FROM users
                     WHERE telegram_id = $1
                     FOR UPDATE`,
                    [
                        String(
                            req.telegramUser.id
                        )
                    ]
                );

            let user;

            if (userResult.rows.length === 0) {
                user =
                    await getOrCreateUser(
                        req.telegramUser,
                        client
                    );
            } else {
                user =
                    userResult.rows[0];

                const refreshed =
                    await client.query(
                        `UPDATE users
                         SET
                            username = $1,
                            first_name = $2,
                            updated_at = NOW()
                         WHERE id = $3
                         RETURNING
                            id,
                            telegram_id,
                            username,
                            first_name,
                            balance,
                            total_mined,
                            miner_level,
                            referrals_count,
                            mining_active,
                            mining_started_at,
                            created_at,
                            updated_at`,
                        [
                            req.telegramUser
                                .username || null,

                            req.telegramUser
                                .first_name ||
                                "DTR User",

                            user.id
                        ]
                    );

                user =
                    refreshed.rows[0];
            }

            // Automatically finish a completed
            // 2-hour mining session.
            if (
                user.mining_active &&
                user.mining_started_at
            ) {
                const elapsed =
                    Date.now() -
                    new Date(
                        user.mining_started_at
                    ).getTime();

                if (
                    elapsed >=
                    MINING_DURATION_MS
                ) {
                    const rate =
                        await getMiningRate(
                            client,
                            user.miner_level
                        );

                    const mined =
                        calculateMiningAmount(
                            user.mining_started_at,
                            rate
                        );

                    const updated =
                        await client.query(
                            `UPDATE users
                             SET
                                balance =
                                    balance + $1,
                                total_mined =
                                    total_mined + $1,
                                mining_active = FALSE,
                                mining_started_at = NULL,
                                updated_at = NOW()
                             WHERE id = $2
                             RETURNING
                                id,
                                telegram_id,
                                username,
                                first_name,
                                balance,
                                total_mined,
                                miner_level,
                                referrals_count,
                                mining_active,
                                mining_started_at,
                                created_at,
                                updated_at`,
                            [
                                mined,
                                user.id
                            ]
                        );

                    user =
                        updated.rows[0];
                }
            }

            await client.query("COMMIT");

            return res.json({
                success: true,
                user: formatUser(user)
            });
        } catch (error) {
            await client
                .query("ROLLBACK")
                .catch(() => {});

            console.error(
                "GET /api/me error:",
                error
            );

            return res.status(500).json({
                error: "Unable to load user"
            });
        } finally {
            client.release();
        }
    }
);

// =========================
// START MINING
// =========================

app.post(
    "/api/mining/start",
    authMiddleware,
    async (req, res) => {
        const client =
            await pool.connect();

        try {
            await client.query("BEGIN");

            const user =
                await getOrCreateUser(
                    req.telegramUser,
                    client
                );

            const lockedResult =
                await client.query(
                    `SELECT
                        id,
                        miner_level,
                        mining_active,
                        mining_started_at
                     FROM users
                     WHERE id = $1
                     FOR UPDATE`,
                    [user.id]
                );

            const locked =
                lockedResult.rows[0];

            if (
                locked.mining_active &&
                locked.mining_started_at
            ) {
                const elapsed =
                    Date.now() -
                    new Date(
                        locked.mining_started_at
                    ).getTime();

                if (
                    elapsed <
                    MINING_DURATION_MS
                ) {
                    await client.query(
                        "ROLLBACK"
                    );

                    return res.status(400).json({
                        error:
                            "Mining is already active"
                    });
                }

                const rate =
                    await getMiningRate(
                        client,
                        locked.miner_level
                    );

                const mined =
                    calculateMiningAmount(
                        locked.mining_started_at,
                        rate
                    );

                await client.query(
                    `UPDATE users
                     SET
                        balance =
                            balance + $1,
                        total_mined =
                            total_mined + $1,
                        mining_active = FALSE,
                        mining_started_at = NULL,
                        updated_at = NOW()
                     WHERE id = $2`,
                    [
                        mined,
                        user.id
                    ]
                );
            }

            const started =
                await client.query(
                    `UPDATE users
                     SET
                        mining_active = TRUE,
                        mining_started_at = NOW(),
                        updated_at = NOW()
                     WHERE id = $1
                     RETURNING
                        id,
                        telegram_id,
                        username,
                        first_name,
                        balance,
                        total_mined,
                        miner_level,
                        referrals_count,
                        mining_active,
                        mining_started_at,
                        created_at,
                        updated_at`,
                    [user.id]
                );

            await client.query("COMMIT");

            return res.json({
                success: true,
                message:
                    "Mining started",
                user:
                    formatUser(
                        started.rows[0]
                    )
            });
        } catch (error) {
            await client
                .query("ROLLBACK")
                .catch(() => {});

            console.error(
                "POST /api/mining/start error:",
                error
            );

            return res.status(500).json({
                error:
                    "Unable to start mining"
            });
        } finally {
            client.release();
        }
    }
);

// =========================
// CLAIM MINING
// =========================

app.post(
    "/api/mining/claim",
    authMiddleware,
    async (req, res) => {
        const client =
            await pool.connect();

        try {
            await client.query("BEGIN");

            const result =
                await client.query(
                    `SELECT
                        id,
                        telegram_id,
                        username,
                        first_name,
                        balance,
                        total_mined,
                        miner_level,
                        referrals_count,
                        mining_active,
                        mining_started_at,
                        created_at,
                        updated_at
                     FROM users
                     WHERE telegram_id = $1
                     FOR UPDATE`,
                    [
                        String(
                            req.telegramUser.id
                        )
                    ]
                );

            if (result.rows.length === 0) {
                await client.query(
                    "ROLLBACK"
                );

                return res.status(404).json({
                    error:
                        "User not found"
                });
            }

            const user =
                result.rows[0];

            if (
                !user.mining_active ||
                !user.mining_started_at
            ) {
                await client.query(
                    "ROLLBACK"
                );

                return res.status(400).json({
                    error:
                        "Mining is not active"
                });
            }

            const elapsed =
                Date.now() -
                new Date(
                    user.mining_started_at
                ).getTime();

            if (
                elapsed <
                MINING_DURATION_MS
            ) {
                await client.query(
                    "ROLLBACK"
                );

                return res.status(400).json({
                    error:
                        "Mining is not complete",

                    remaining_ms:
                        MINING_DURATION_MS -
                        elapsed
                });
            }

            const rate =
                await getMiningRate(
                    client,
                    user.miner_level
                );

            const mined =
                calculateMiningAmount(
                    user.mining_started_at,
                    rate
                );

            const updated =
                await client.query(
                    `UPDATE users
                     SET
                        balance =
                            balance + $1,
                        total_mined =
                            total_mined + $1,
                        mining_active = FALSE,
                        mining_started_at = NULL,
                        updated_at = NOW()
                     WHERE id = $2
                     RETURNING
                        id,
                        telegram_id,
                        username,
                        first_name,
                        balance,
                        total_mined,
                        miner_level,
                        referrals_count,
                        mining_active,
                        mining_started_at,
                        created_at,
                        updated_at`,
                    [
                        mined,
                        user.id
                    ]
                );

            await client.query("COMMIT");

            return res.json({
                success: true,
                mined,

                user:
                    formatUser(
                        updated.rows[0]
                    )
            });
        } catch (error) {
            await client
                .query("ROLLBACK")
                .catch(() => {});

            console.error(
                "POST /api/mining/claim error:",
                error
            );

            return res.status(500).json({
                error:
                    "Unable to claim mining"
            });
        } finally {
            client.release();
        }
    }
);

// =========================
// GET MINERS
// =========================

app.get(
    "/api/miners",
    authMiddleware,
    async (req, res) => {
        try {
            const result =
                await query(
                    `SELECT
                        level,
                        name,
                        rate_per_hour,
                        price
                     FROM miners
                     ORDER BY level ASC`
                );

            return res.json({
                success: true,

                miners:
                    result.rows.map(
                        (miner) => ({
                            level:
                                miner.level,

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
                "GET /api/miners error:",
                error
            );

            return res.status(500).json({
                error:
                    "Unable to load miners"
            });
        }
    }
);

// =========================
// UPGRADE MINER
// =========================

app.post(
    "/api/miners/upgrade",
    authMiddleware,
    async (req, res) => {
        const client =
            await pool.connect();

        try {
            await client.query("BEGIN");

            const userResult =
                await client.query(
                    `SELECT
                        id,
                        balance,
                        miner_level
                     FROM users
                     WHERE telegram_id = $1
                     FOR UPDATE`,
                    [
                        String(
                            req.telegramUser.id
                        )
                    ]
                );

            if (userResult.rows.length === 0) {
                await client.query(
                    "ROLLBACK"
                );

                return res.status(404).json({
                    error:
                        "User not found"
                });
            }

            const user =
                userResult.rows[0];

            const nextLevel = Number(
                user.miner_level + 1
            );

            const minerResult =
                await client.query(
                    `SELECT
                        level,
                        rate_per_hour,
                        price
                     FROM miners
                     WHERE level = $1`,
                    [nextLevel]
                );

            if (minerResult.rows.length === 0) {
                await client.query(
                    "ROLLBACK"
                );

                return res.status(400).json({
                    error:
                        "Max level reached"
                });
            }

            const nextMiner =
                minerResult.rows[0];

            const price = Number(
                nextMiner.price
            );

            if (
                Number(user.balance) <
                price
            ) {
                await client.query(
                    "ROLLBACK"
                );

                return res.status(400).json({
                    error:
                        "Insufficient balance"
                });
            }

            const upgraded =
                await client.query(
                    `UPDATE users
                     SET
                        balance =
                            balance - $1,
                        miner_level = $2,
                        updated_at = NOW()
                     WHERE id = $3
                     RETURNING
                        id,
                        telegram_id,
                        username,
                        first_name,
                        balance,
                        total_mined,
                        miner_level,
                        referrals_count,
                        mining_active,
                        mining_started_at,
                        created_at,
                        updated_at`,
                    [
                        price,
                        nextLevel,
                        user.id
                    ]
                );

            await client.query("COMMIT");

            return res.json({
                success: true,
                message: "Miner upgraded",
                user:
                    formatUser(
                        upgraded.rows[0]
                    )
            });
        } catch (error) {
            await client
                .query("ROLLBACK")
                .catch(() => {});

            console.error(
                "POST /api/miners/upgrade error:",
                error
            );

            return res.status(500).json({
                error:
                    "Unable to upgrade miner"
            });
        } finally {
            client.release();
        }
    }
);

// =========================
// REFERRALS
// =========================

app.get(
    "/api/referrals",
    authMiddleware,
    async (req, res) => {
        try {
            const result =
                await query(
                    `SELECT
                        referrals_count
                     FROM users
                     WHERE telegram_id = $1`,
                    [
                        String(
                            req.telegramUser.id
                        )
                    ]
                );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error:
                        "User not found"
                });
            }

            return res.json({
                success: true,
                referrals_count:
                    result.rows[0]
                        .referrals_count
            });
        } catch (error) {
            console.error(
                "GET /api/referrals error:",
                error
            );

            return res.status(500).json({
                error:
                    "Unable to load referrals"
            });
        }
    }
);

// =========================
// START SERVER
// =========================

app.listen(PORT, () => {
    console.log(
        `DTR Miner server listening on port ${PORT}`
    );
});
