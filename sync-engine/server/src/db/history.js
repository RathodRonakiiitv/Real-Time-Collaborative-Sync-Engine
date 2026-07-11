/**
 * History — Fold-Based Document Reconstruction from PostgreSQL
 * ==========================================================
 * Reconstructs a document at any historical version by folding
 * operations through applyOp(). This is the persistence-backed
 * counterpart to DocumentEngine.getDocumentAtVersion().
 *
 * Strategy:
 *   1. Find the closest snapshot AT OR BEFORE the target version
 *   2. Fetch ops from (snapshot.version, targetVersion]
 *   3. Fold: reduce ops through applyOp() starting from snapshot
 *
 * If no snapshot exists, folds from version 0 (empty string).
 * This guarantees correctness even if snapshots are stale or
 * missing — the fold is the source of truth.
 * ==========================================================
 */

'use strict';

const { pool } = require('./pool');
const { applyOp } = require('../ot/operations');

/**
 * Get the closest snapshot at or before a target version.
 * Used as an optimization starting point for fold reconstruction.
 *
 * @param {string} docId
 * @param {number} targetVersion
 * @returns {{ version: number, content: string } | null}
 */
async function getSnapshotAtOrBefore(docId, targetVersion) {
  const { rows } = await pool.query(
    `SELECT version, content
     FROM snapshots
     WHERE doc_id = $1 AND version <= $2
     ORDER BY version DESC
     LIMIT 1`,
    [docId, targetVersion]
  );
  if (rows.length === 0) return null;
  return { version: rows[0].version, content: rows[0].content };
}

/**
 * Fetch operations in a specific version range.
 *
 * @param {string} docId
 * @param {number} fromVersion - Exclusive lower bound
 * @param {number} toVersion   - Inclusive upper bound
 * @returns {Array<{ version, op, clientId, timestamp }>}
 */
async function getOpsRange(docId, fromVersion, toVersion) {
  const { rows } = await pool.query(
    `SELECT version, op_data, client_id, created_at
     FROM operations
     WHERE doc_id = $1 AND version > $2 AND version <= $3
     ORDER BY version ASC`,
    [docId, fromVersion, toVersion]
  );
  return rows.map(row => ({
    version:   row.version,
    op:        row.op_data,
    clientId:  row.client_id,
    timestamp: row.created_at,
  }));
}

/**
 * Fold-based document reconstruction from PostgreSQL.
 *
 * Reconstructs the document at `targetVersion` by:
 *   1. Loading the nearest snapshot ≤ targetVersion (if any)
 *   2. Fetching all ops between the snapshot and target
 *   3. Folding ops through applyOp() to produce the document
 *
 * This is never a cache lookup — even when a snapshot exists at
 * the exact target version, we still fold from it (0 ops folded
 * in that edge case, but the pathway is always fold-based).
 *
 * @param {string} docId
 * @param {number} targetVersion
 * @returns {{ doc: string, version: number, opsApplied: number, foldedFromSnapshot: boolean }}
 */
async function foldDocument(docId, targetVersion) {
  if (targetVersion < 0) {
    throw new RangeError(`targetVersion must be non-negative, got: ${targetVersion}`);
  }

  // Version 0 = empty document, no work needed
  if (targetVersion === 0) {
    return { doc: '', version: 0, opsApplied: 0, foldedFromSnapshot: false };
  }

  // 1. Find the nearest snapshot as our fold starting point
  const snapshot = await getSnapshotAtOrBefore(docId, targetVersion);

  let doc = '';
  let startVersion = 0;
  let foldedFromSnapshot = false;

  if (snapshot) {
    doc = snapshot.content;
    startVersion = snapshot.version;
    foldedFromSnapshot = true;
  }

  // 2. Fetch ops from startVersion to targetVersion
  const ops = await getOpsRange(docId, startVersion, targetVersion);

  // 3. Fold: reduce through applyOp
  for (const entry of ops) {
    const result = applyOp(doc, entry.op);
    doc = result.doc;
  }

  return {
    doc,
    version: targetVersion,
    opsApplied: ops.length,
    foldedFromSnapshot,
  };
}

/**
 * Get operation history metadata from PostgreSQL.
 * Returns lightweight metadata for timeline display.
 *
 * @param {string} docId
 * @param {number} [limit=100]  - Max ops to return
 * @param {number} [offset=0]   - Offset for pagination
 * @returns {{ ops: Array, total: number }}
 */
async function getPersistedHistory(docId, limit = 100, offset = 0) {
  // Get total count
  const countResult = await pool.query(
    `SELECT COUNT(*) AS total FROM operations WHERE doc_id = $1`,
    [docId]
  );
  const total = parseInt(countResult.rows[0].total, 10);

  // Get paginated ops
  const { rows } = await pool.query(
    `SELECT version, op_data, client_id, created_at
     FROM operations
     WHERE doc_id = $1
     ORDER BY version DESC
     LIMIT $2 OFFSET $3`,
    [docId, limit, offset]
  );

  const ops = rows.map(row => ({
    version:    row.version,
    clientId:   row.client_id,
    type:       row.op_data.type,
    position:   row.op_data.position,
    textLength: row.op_data.type === 'insert'
      ? (row.op_data.text || '').length
      : (row.op_data.length || 0),
    text:       row.op_data.type === 'insert'
      ? (row.op_data.text || '').slice(0, 80)
      : null,
    timestamp:  row.created_at,
  }));

  return { ops, total };
}

module.exports = {
  getSnapshotAtOrBefore,
  getOpsRange,
  foldDocument,
  getPersistedHistory,
};
