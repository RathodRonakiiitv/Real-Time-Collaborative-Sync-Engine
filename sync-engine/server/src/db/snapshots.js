/**
 * Snapshot Persistence
 * ==========================================================
 * Periodic document state checkpoints in PostgreSQL.
 * Used for fast recovery on server restart — load snapshot,
 * then replay ops since the snapshot version.
 * ==========================================================
 */

'use strict';

const { pool } = require('./pool');

/**
 * Save a document snapshot.
 * @param {string} docId
 * @param {number} version  - The version this snapshot represents
 * @param {string} content  - Full document text at this version
 */
async function saveSnapshot(docId, version, content) {
  await pool.query(
    `INSERT INTO snapshots (doc_id, version, content)
     VALUES ($1, $2, $3)`,
    [docId, version, content]
  );
  console.log(`[Snapshot] Saved snapshot for doc=${docId} at version=${version}`);
}

/**
 * Load the most recent snapshot for a document.
 * @param {string} docId
 * @returns {{ version: number, content: string } | null}
 */
async function getLatestSnapshot(docId) {
  const { rows } = await pool.query(
    `SELECT version, content, created_at
     FROM snapshots
     WHERE doc_id = $1
     ORDER BY version DESC
     LIMIT 1`,
    [docId]
  );
  if (rows.length === 0) return null;
  return {
    version: rows[0].version,
    content: rows[0].content,
  };
}

module.exports = { saveSnapshot, getLatestSnapshot };
