/**
 * PostgreSQL Connection Pool
 * ==========================================================
 * Provides a shared connection pool for all database modules.
 * Configured via environment variables (or .env file).
 * ==========================================================
 */

'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.PG_HOST     || '127.0.0.1',
  port:     parseInt(process.env.PG_PORT || '5432', 10),
  user:     process.env.PG_USER     || 'syncuser',
  password: process.env.PG_PASSWORD || 'syncpass',
  database: process.env.PG_DATABASE || 'syncengine',
  max:      20,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[PostgreSQL] Unexpected pool error:', err.message);
});

module.exports = { pool };
