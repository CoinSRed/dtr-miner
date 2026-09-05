-- DTR Miner Database
-- PostgreSQL

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT NOT NULL DEFAULT 'DTR User',

    balance NUMERIC(30, 8) NOT NULL DEFAULT 0,
    total_mined NUMERIC(30, 8) NOT NULL DEFAULT 0,

    miner_level INTEGER NOT NULL DEFAULT 1,
    referrals_count INTEGER NOT NULL DEFAULT 0,

    mining_active BOOLEAN NOT NULL DEFAULT FALSE,
    mining_started_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS miners (
    level INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    rate_per_hour NUMERIC(20, 8) NOT NULL,
    price NUMERIC(30, 8) NOT NULL,
    ton_price_usd NUMERIC(10, 2) NOT NULL DEFAULT 0
);

INSERT INTO miners (level, name, rate_per_hour, price)
VALUES
    (1, 'Basic Miner', 0.20, 0),
    (2, 'Advanced Miner', 0.50, 100),
    (3, 'Pro Miner', 1.00, 500),
    (4, 'Ultra Miner', 2.50, 1500),
    (5, 'DTR Miner V', 5.00, 5000),
    (6, 'DTR Miner VI', 7.00, 0),
    (7, 'DTR Miner VII', 9.00, 0),
    (8, 'DTR Miner VIII', 12.00, 0),
    (9, 'DTR Miner IX', 16.00, 0),
    (10, 'DTR Miner X', 21.00, 0),
    (11, 'DTR Miner XI', 27.00, 0),
    (12, 'DTR Miner XII', 34.00, 0),
    (13, 'DTR Miner XIII', 42.00, 0),
    (14, 'DTR Miner XIV', 51.00, 0),
    (15, 'DTR Miner XV', 61.00, 0),
    (16, 'DTR Miner XVI', 72.00, 0),
    (17, 'DTR Miner XVII', 84.00, 0),
    (18, 'DTR Miner XVIII', 97.00, 0),
    (19, 'DTR Miner XIX', 111.00, 0),
    (20, 'DTR Miner XX', 126.00, 0),
    (21, 'DTR Miner XXI', 142.00, 0),
    (22, 'DTR Miner XXII', 159.00, 0),
    (23, 'DTR Miner XXIII', 177.00, 0),
    (24, 'DTR Miner XXIV', 196.00, 0),
    (25, 'DTR Miner XXV', 216.00, 0),
    (26, 'DTR Miner XXVI', 237.00, 0),
    (27, 'DTR Miner XXVII', 259.00, 0),
    (28, 'DTR Miner XXVIII', 282.00, 0),
    (29, 'DTR Miner XXIX', 306.00, 0),
    (30, 'DTR Miner XXX', 330.00, 0)
ON CONFLICT (level) DO NOTHING;

UPDATE miners SET ton_price_usd = 1.00 WHERE level = 6;
UPDATE miners SET ton_price_usd = 1.00 WHERE level = 7;
UPDATE miners SET ton_price_usd = 2.00 WHERE level = 8;
UPDATE miners SET ton_price_usd = 2.00 WHERE level = 9;
UPDATE miners SET ton_price_usd = 3.00 WHERE level = 10;
UPDATE miners SET ton_price_usd = 3.00 WHERE level = 11;
UPDATE miners SET ton_price_usd = 3.00 WHERE level = 12;
UPDATE miners SET ton_price_usd = 4.00 WHERE level = 13;
UPDATE miners SET ton_price_usd = 4.00 WHERE level = 14;
UPDATE miners SET ton_price_usd = 4.00 WHERE level = 15;
UPDATE miners SET ton_price_usd = 5.00 WHERE level = 16;
UPDATE miners SET ton_price_usd = 5.00 WHERE level = 17;
UPDATE miners SET ton_price_usd = 5.00 WHERE level = 18;
UPDATE miners SET ton_price_usd = 6.00 WHERE level = 19;
UPDATE miners SET ton_price_usd = 6.00 WHERE level = 20;
UPDATE miners SET ton_price_usd = 6.00 WHERE level = 21;
UPDATE miners SET ton_price_usd = 7.00 WHERE level = 22;
UPDATE miners SET ton_price_usd = 7.00 WHERE level = 23;
UPDATE miners SET ton_price_usd = 7.00 WHERE level = 24;
UPDATE miners SET ton_price_usd = 8.00 WHERE level = 25;
UPDATE miners SET ton_price_usd = 8.00 WHERE level = 26;
UPDATE miners SET ton_price_usd = 8.00 WHERE level = 27;
UPDATE miners SET ton_price_usd = 9.00 WHERE level = 28;
UPDATE miners SET ton_price_usd = 9.00 WHERE level = 29;
UPDATE miners SET ton_price_usd = 10.00 WHERE level = 30;


CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    task_key TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    reward NUMERIC(30, 8) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO tasks (task_key, title, reward)
VALUES
    ('telegram', 'Join our Telegram', 10),
    ('channel', 'Follow our channel', 15),
    ('daily', 'Daily Bonus', 5)
ON CONFLICT (task_key) DO NOTHING;


CREATE TABLE IF NOT EXISTS user_tasks (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(user_id, task_id)
);


CREATE TABLE IF NOT EXISTS referrals (
    id BIGSERIAL PRIMARY KEY,

    inviter_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_id BIGINT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    reward NUMERIC(30, 8) NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS withdrawals (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    amount NUMERIC(30, 8) NOT NULL,
    wallet_address TEXT,

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'paid', 'rejected')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);


CREATE INDEX IF NOT EXISTS idx_users_telegram_id
ON users(telegram_id);

CREATE INDEX IF NOT EXISTS idx_referrals_inviter
ON referrals(inviter_id);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user
ON withdrawals(user_id);

CREATE INDEX IF NOT EXISTS idx_withdrawals_status
ON withdrawals(status);