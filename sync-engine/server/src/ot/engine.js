/**
 * OT Engine — Document Engine
 * ==========================================================
 * Maintains the authoritative document state and operation log.
 * Coordinates applying incoming ops via the OT transform.
 *
 * Usage (server-side):
 *   const engine = new DocumentEngine('doc-1');
 *   engine.applyClientOp(op, clientVersion);
 * ==========================================================
 */

'use strict';

const { applyOp, transform, validateOp } = require('./operations');

class DocumentEngine {
  /**
   * @param {string} docId      - Unique document identifier
   * @param {string} initialDoc - Initial document content (default: empty)
   */
  constructor(docId, initialDoc = '') {
    this.docId   = docId;
    this.doc     = initialDoc;
    this.version = 0;          // monotonically-increasing server version
    this.opLog   = [];         // immutable history: { op, version, timestamp }
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
  receiveOp(clientOp, clientVersion) {
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
   * Get ops since a given version (for catch-up on reconnect).
   * @param {number} sinceVersion
   * @returns {Array}
   */
  getOpsSince(sinceVersion) {
    return this.opLog.slice(sinceVersion);
  }

  /**
   * Snapshot: returns state for persistence (Phase 3).
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
}

module.exports = { DocumentEngine };
