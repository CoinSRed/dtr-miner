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
    price NUMERIC(30, 8) NOT NULL
);

INSERT INTO miners (level, name, rate_per_hour, price)
VALUES
    (1, 'Basic Miner', 0.20, 0),
    (2, 'Advanced Miner', 0.50, 100),
    (3, 'Pro Miner', 1.00, 500),
    (4, 'Ultra Miner', 2.50, 1500),
    (5, 'DTR Miner V', 5.00, 5000)
ON CONFLICT (level) DO NOTHING;


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