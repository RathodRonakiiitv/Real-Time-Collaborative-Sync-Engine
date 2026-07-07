/**
 * OT Engine — Document Engine (with persistence hooks)
 * ==========================================================
 * Maintains the authoritative document state and operation log.
 * Coordinates applying incoming ops via the OT transform.
 *
 * Usage (server-side):
 *   const engine = new DocumentEngine('doc-1');
 *   engine.applyClientOp(op, clientVersion);
 *
 * Persistence integration:
 *   - After each op: persists to PostgreSQL + caches in Redis
 *   - Snapshots every SNAPSHOT_INTERVAL ops
 *   - loadFromSnapshot() for server recovery
 * ==========================================================
 */

'use strict';

const { applyOp, transform, validateOp } = require('./operations');

const SNAPSHOT_INTERVAL = 50; // Snapshot every 50 ops

class DocumentEngine {
  /**
   * @param {string} docId      - Unique document identifier
   * @param {string} initialDoc - Initial document content (default: empty)
   * @param {object} [persistence] - Optional persistence layer
   * @param {Function} persistence.saveOp   - (docId, version, op, clientId) => Promise
   * @param {Function} persistence.cacheOp  - (docId, version, op) => Promise
   * @param {Function} persistence.cacheDocState - (docId, doc, version) => Promise
   * @param {Function} persistence.saveSnapshot  - (docId, version, content) => Promise
   */
  constructor(docId, initialDoc = '', persistence = null) {
    this.docId       = docId;
    this.doc         = initialDoc;
    this.version     = 0;          // monotonically-increasing server version
    this.opLog       = [];         // immutable history: { op, version, timestamp }
    this.persistence = persistence;
    this._opsSinceSnapshot = 0;
  }

  /**
   * Receive an op from a client at a given client-side version.
   * Transform the op against all ops that were applied on the server
   * since the client's version, then apply and log it.
   *
   * @param {Operation} clientOp      - The raw op from the client
   * @param {number}    clientVersion - The version the client was at when it created the op
   * @returns {{ transformedOp, newVersion, doc }} - Result to broadcast
   */
  async receiveOp(clientOp, clientVersion) {
    validateOp(clientOp);

    // Fetch all ops the server has applied since the client's version
    const concurrentOps = this.opLog
      .slice(clientVersion)
      .map(entry => entry.op);

    // Transform clientOp against each concurrent op in server order
    let transformedOp = { ...clientOp };
    for (const serverOp of concurrentOps) {
      transformedOp = transform(serverOp, transformedOp);
      if (transformedOp === null) {
        // Op was completely absorbed by server ops → skip
        return { transformedOp: null, newVersion: this.version, doc: this.doc };
      }
    }

    // Apply the transformed op
    this.doc = applyOp(this.doc, transformedOp);
    this.version += 1;

    const entry = {
      op:        transformedOp,
      version:   this.version,
      clientId:  clientOp.clientId,
      timestamp: Date.now(),
    };
    this.opLog.push(entry);

    // ── Persistence hooks ──────────────────────────────────
    if (this.persistence) {
      try {
        const p = this.persistence;
        // Fire-and-forget for performance; errors are logged but don't block
        await Promise.all([
          p.saveOp    ? p.saveOp(this.docId, this.version, transformedOp, clientOp.clientId) : null,
          p.cacheOp   ? p.cacheOp(this.docId, this.version, transformedOp) : null,
          p.cacheDocState ? p.cacheDocState(this.docId, this.doc, this.version) : null,
        ]);

        // Auto-snapshot every SNAPSHOT_INTERVAL ops
        this._opsSinceSnapshot += 1;
        if (this._opsSinceSnapshot >= SNAPSHOT_INTERVAL && p.saveSnapshot) {
          await p.saveSnapshot(this.docId, this.version, this.doc);
          this._opsSinceSnapshot = 0;
        }
      } catch (err) {
        console.error(`[Engine] Persistence error for doc=${this.docId}:`, err.message);
      }
    }

    return {
      transformedOp,
      newVersion: this.version,
      doc: this.doc,
    };
  }

  /**
   * Get the current document content.
   * @returns {string}
   */
  getDocument() {
    return this.doc;
  }

  /**
   * Get current server version.
   * @returns {number}
   */
  getVersion() {
    return this.version;
  }

  /**
   * Get ops since a given version (for catch-up on reconnect).
   * @param {number} sinceVersion
   * @returns {Array}
   */
  getOpsSince(sinceVersion) {
    return this.opLog.slice(sinceVersion);
  }

  /**
   * Load engine state from a snapshot + replay ops.
   * Used for server recovery after restart.
   * @param {string} doc          - Document content at snapshot
   * @param {number} version      - Version at snapshot
   * @param {Array}  opsToReplay  - Ops since snapshot version
   */
  loadFromSnapshot(doc, version, opsToReplay = []) {
    this.doc     = doc;
    this.version = version;
    this.opLog   = [];

    // Rebuild the in-memory op log from the replayed ops
    for (const entry of opsToReplay) {
      const op = entry.op || entry.op_data || entry;
      this.doc = applyOp(this.doc, op);
      this.version += 1;
      this.opLog.push({
        op,
        version:   this.version,
        clientId:  entry.clientId || entry.client_id || 'replay',
        timestamp: entry.timestamp || Date.now(),
      });
    }

    this._opsSinceSnapshot = opsToReplay.length;
    console.log(`[Engine] Loaded doc=${this.docId} from snapshot: version=${this.version}, doc length=${this.doc.length}`);
  }

  /**
   * Snapshot: returns state for persistence.
   * @returns {{ docId, doc, version, opLog }}
   */
  snapshot() {
    return {
      docId:   this.docId,
      doc:     this.doc,
      version: this.version,
      opLog:   [...this.opLog],
    };
  }

  /**
   * Check if the engine should create a snapshot.
   * @returns {boolean}
   */
  shouldSnapshot() {
    return this._opsSinceSnapshot >= SNAPSHOT_INTERVAL;
  }
}

module.exports = { DocumentEngine, SNAPSHOT_INTERVAL };
