/**
 * Operations Persistence
 * ==========================================================
 * Persists every operation to PostgreSQL for event sourcing.
 * Provides catch-up queries for reconnecting clients.
 * ==========================================================
 */

'use strict';

const { pool } = require('./pool');

/**
 * Save an operation to the database.
 * @param {string} docId
 * @param {number} version
 * @param {object} op       - The transformed operation (JSONB)
 * @param {string} clientId
 */
async function saveOp(docId, version, op, clientId) {
  await pool.query(
    `INSERT INTO operations (doc_id, version, op_data, client_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (doc_id, version) DO NOTHING`,
    [docId, version, JSON.stringify(op), clientId]
  );
}

/**
 * Fetch all operations for a document since a given version.
 * Used for catch-up on reconnect (fallback when Redis cache misses).
 * @param {string} docId
 * @param {number} sinceVersion - Exclusive lower bound
 * @returns {Array<{ version, op_data, client_id, created_at }>}
 */
async function getOpsSince(docId, sinceVersion) {
  const { rows } = await pool.query(
    `SELECT version, op_data, client_id, created_at
     FROM operations
     WHERE doc_id = $1 AND version > $2
     ORDER BY version ASC`,
    [docId, sinceVersion]
  );
  return rows.map(row => ({
    version:   row.version,
    op:        row.op_data,
    clientId:  row.client_id,
    timestamp: row.created_at,
  }));
}

/**
 * Get the latest version number for a document.
 * @param {string} docId
 * @returns {number} - Latest version, or 0 if no ops exist
 */
async function getLatestVersion(docId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(version), 0) AS latest
     FROM operations
     WHERE doc_id = $1`,
    [docId]
  );
  return rows[0].latest;
}

module.exports = { saveOp, getOpsSince, getLatestVersion };
