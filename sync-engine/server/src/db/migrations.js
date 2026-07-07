/**
 * Database Migrations
 * ==========================================================
 * Auto-creates the `operations` and `snapshots` tables on
 * server startup. Idempotent — uses IF NOT EXISTS.
 * ==========================================================
 */

'use strict';

const { pool } = require('./pool');

async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Operations table — immutable event log
    await client.query(`
      CREATE TABLE IF NOT EXISTS operations (
        id          SERIAL PRIMARY KEY,
        doc_id      VARCHAR(255)  NOT NULL,
        version     INTEGER       NOT NULL,
        op_data     JSONB         NOT NULL,
        client_id   VARCHAR(255)  NOT NULL,
        created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        UNIQUE(doc_id, version)
      );
    `);

    // Index for fast catch-up queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_operations_doc_version
        ON operations (doc_id, version);
    `);

    // Snapshots table — periodic document state checkpoints
    await client.query(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id          SERIAL PRIMARY KEY,
        doc_id      VARCHAR(255)  NOT NULL,
        version     INTEGER       NOT NULL,
        content     TEXT          NOT NULL,
        created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
    `);

    // Index for fast latest-snapshot lookup
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_snapshots_doc_version
        ON snapshots (doc_id, version DESC);
    `);

    await client.query('COMMIT');
    console.log('[Migrations] Tables created/verified successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migrations] Failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };
