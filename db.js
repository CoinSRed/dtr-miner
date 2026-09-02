const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.on("error", (error) => {
    console.error("PostgreSQL pool error:", error);
});

async function query(text, params = []) {
    return pool.query(text, params);
}

async function testDatabase() {
    const result = await pool.query("SELECT NOW() AS time");
    return result.rows[0];
}

module.exports = {
    pool,
    query,
    testDatabase
};