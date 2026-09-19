const { Pool, types } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

// node-postgres returns BIGINT/NUMERIC as strings to avoid precision loss.
// This app uses them as plain numbers, so parse them back to Number.
types.setTypeParser(types.builtins.INT8, (value) => value === null ? null : parseInt(value, 10));
types.setTypeParser(types.builtins.NUMERIC, (value) => value === null ? null : parseFloat(value));


const dbName = process.env.PGDATABASE || process.env.DB_NAME || 'limbe_police_cms';
const sslRequired = ['require', 'verify-ca', 'verify-full'].includes((process.env.PGSSLMODE || '').toLowerCase());

const pool = new Pool({
    host: process.env.PGHOST || process.env.DB_HOST || 'localhost',
    user: process.env.PGUSER || process.env.DB_USER || 'postgres',
    password: process.env.PGPASSWORD || process.env.DB_PASSWORD || '',
    database: dbName,
    port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
    ssl: sslRequired ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 3000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});


function convertPlaceholders(sql) {
    let index = 0;
    return String(sql).replace(/\?/g, () => `$${++index}`);
}


function isInsert(sql) {
    return /^\s*insert\s+into/i.test(sql);
}


function isSelect(sql) {
    return /^\s*(select|show|with|values)/i.test(sql);
}


async function execute(sql, params) {
    const values = Array.isArray(params) ? params : [];
    let text = convertPlaceholders(sql);

    // Emulate MySQL's AUTO_INCREMENT insertId behaviour.
    if (isInsert(text) && !/\breturning\b/i.test(text)) {
        text += ' RETURNING id';
    }

    const result = await pool.query(text, values);

    if (isInsert(text)) {
        const inserted = result.rows && result.rows[0];
        return [{ insertId: inserted ? inserted.id : 0, affectedRows: result.rowCount, ...(inserted || {}) }];
    }

    if (isSelect(text)) {
        return [result.rows];
    }

    return [{ affectedRows: result.rowCount }];
}


pool.query('SELECT 1')
    .then(() => {
        console.log(`✅ PostgreSQL Database Connected Successfully [Database: ${dbName}]`);
    })
    .catch((err) => {
        console.error('❌ Database Connection Error:', err.message);
    });


module.exports = {
    execute,
    query: (sql, params) => pool.query(sql, params),
    pool
};