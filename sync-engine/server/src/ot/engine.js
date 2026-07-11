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

const { applyOp, transform, validateOp, invertOp } = require('./operations');

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
    this.version     = 0;
    this.opLog       = [];         // { op, version, clientId, timestamp, deletedText }
    this.persistence = persistence;
    this._opsSinceSnapshot = 0;

    // Per-user undo/redo stacks: userId → [ opLogIndex, ... ]
    // Each entry is the index in opLog of an op this user applied.
    // On undo: pop from undoStack, transform inverse, apply, push to redoStack.
    this._undoStacks = new Map(); // userId → number[]
    this._redoStacks = new Map(); // userId → number[]
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
    const { doc: newDoc, deletedText } = applyOp(this.doc, transformedOp);
    this.doc      = newDoc;
    this.version += 1;

    const entry = {
      op:          transformedOp,
      version:     this.version,
      clientId:    clientOp.clientId,
      timestamp:   Date.now(),
      deletedText, // stored for undo inverse reconstruction
    };
    this.opLog.push(entry);

    // Track this op on the user's undo stack (clear their redo stack)
    const userId = clientOp.clientId;
    if (!this._undoStacks.has(userId)) this._undoStacks.set(userId, []);
    this._undoStacks.get(userId).push(this.opLog.length - 1); // index into opLog
    this._redoStacks.set(userId, []); // new real op clears redo history

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
    this._undoStacks = new Map();
    this._redoStacks = new Map();

    for (const entry of opsToReplay) {
      const op = entry.op || entry.op_data || entry;
      const { doc: newDoc, deletedText } = applyOp(this.doc, op);
      this.doc      = newDoc;
      this.version += 1;
      this.opLog.push({
        op,
        version:     this.version,
        clientId:    entry.clientId || entry.client_id || 'replay',
        timestamp:   entry.timestamp || Date.now(),
        deletedText: deletedText || null,
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

  // ─────────────────────────────────────────────────────
  // PER-USER SELECTIVE UNDO / REDO
  // ─────────────────────────────────────────────────────

  /**
   * Undo the last op from a specific user.
   *
   * Algorithm:
   *   1. Find the user's last op in the op log (via undoStack)
   *   2. Compute its inverse (insert→delete, delete→insert)
   *   3. Transform the inverse against every server op that was
   *      applied AFTER the user's op (same logic as receiveOp)
   *   4. Apply the transformed inverse to the document
   *   5. Push the "undo op index" onto the redo stack
   *
   * This never touches another user's ops — only the inverse of
   * the requesting user's last edit is applied.
   *
   * @param {string} userId
   * @returns {{ transformedOp, newVersion, doc } | null}
   */
  async undoOp(userId) {
    const undoStack = this._undoStacks.get(userId);
    if (!undoStack || undoStack.length === 0) {
      return null; // nothing to undo
    }

    // Pop the last op this user made
    const logIndex = undoStack.pop();
    const entry    = this.opLog[logIndex];

    // Build the inverse op (carries deletedText for delete→insert)
    const opWithDeletedText = { ...entry.op, deletedText: entry.deletedText };
    let inverseOp = invertOp(opWithDeletedText);
    inverseOp = { ...inverseOp, clientId: userId };

    // Transform the inverse against all ops that were applied
    // AFTER the original op (i.e., from logIndex+1 to end of log)
    const subsequentOps = this.opLog.slice(logIndex + 1).map(e => e.op);
    for (const serverOp of subsequentOps) {
      inverseOp = transform(serverOp, inverseOp);
      if (inverseOp === null) {
        // The undo was completely absorbed — nothing left to apply
        // Still pop the stack so we don't get stuck
        this._redoStacks.get(userId)?.push(logIndex) ||
          this._redoStacks.set(userId, [logIndex]);
        return { transformedOp: null, newVersion: this.version, doc: this.doc };
      }
    }

    // Apply the transformed inverse
    const { doc: newDoc, deletedText } = applyOp(this.doc, inverseOp);
    this.doc      = newDoc;
    this.version += 1;

    const undoEntry = {
      op:          inverseOp,
      version:     this.version,
      clientId:    userId,
      timestamp:   Date.now(),
      deletedText,
      isUndo:      true, // mark so we can identify undo ops in the log
    };
    this.opLog.push(undoEntry);

    // Push to redo stack so user can redo this undo
    if (!this._redoStacks.has(userId)) this._redoStacks.set(userId, []);
    this._redoStacks.get(userId).push(this.opLog.length - 1);

    return {
      transformedOp: inverseOp,
      newVersion:    this.version,
      doc:           this.doc,
    };
  }

  /**
   * Redo the last undone op for a specific user.
   * Inverts the undo op (which is itself an inverse), effectively
   * re-applying the original edit.
   *
   * @param {string} userId
   * @returns {{ transformedOp, newVersion, doc } | null}
   */
  async redoOp(userId) {
    const redoStack = this._redoStacks.get(userId);
    if (!redoStack || redoStack.length === 0) {
      return null; // nothing to redo
    }

    const logIndex = redoStack.pop();
    const entry    = this.opLog[logIndex];

    const opWithDeletedText = { ...entry.op, deletedText: entry.deletedText };
    let redoInverse = invertOp(opWithDeletedText);
    redoInverse = { ...redoInverse, clientId: userId };

    const subsequentOps = this.opLog.slice(logIndex + 1).map(e => e.op);
    for (const serverOp of subsequentOps) {
      redoInverse = transform(serverOp, redoInverse);
      if (redoInverse === null) {
        return { transformedOp: null, newVersion: this.version, doc: this.doc };
      }
    }

    const { doc: newDoc, deletedText } = applyOp(this.doc, redoInverse);
    this.doc      = newDoc;
    this.version += 1;

    const redoEntry = {
      op:          redoInverse,
      version:     this.version,
      clientId:    userId,
      timestamp:   Date.now(),
      deletedText,
      isRedo:      true,
    };
    this.opLog.push(redoEntry);

    // Re-push onto undo stack so they can undo the redo
    if (!this._undoStacks.has(userId)) this._undoStacks.set(userId, []);
    this._undoStacks.get(userId).push(this.opLog.length - 1);

    return {
      transformedOp: redoInverse,
      newVersion:    this.version,
      doc:           this.doc,
    };
  }

  /**
   * How many ops a user can undo / redo.
   * @param {string} userId
   * @returns {{ undoDepth: number, redoDepth: number }}
   */
  getUndoRedoDepth(userId) {
    return {
      undoDepth: this._undoStacks.get(userId)?.length ?? 0,
      redoDepth: this._redoStacks.get(userId)?.length ?? 0,
    };
  }

  // ─────────────────────────────────────────────────────
  // FOLD-BASED DOCUMENT RECONSTRUCTION
  // ─────────────────────────────────────────────────────

  /**
   * Reconstruct the document at a specific version by folding
   * operations through applyOp() from version 0.
   *
   * This is a genuine event-sourcing replay — not a snapshot lookup.
   * Even if a snapshot exists at the target version, we reconstruct
   * by folding to ensure correctness.
   *
   * @param {number} targetVersion - Version to reconstruct (1-indexed)
   * @returns {{ doc: string, version: number, opsApplied: number }}
   */
  getDocumentAtVersion(targetVersion) {
    if (targetVersion < 0) {
      throw new RangeError(`targetVersion must be non-negative, got: ${targetVersion}`);
    }
    if (targetVersion > this.version) {
      throw new RangeError(`targetVersion ${targetVersion} exceeds current version ${this.version}`);
    }

    // Version 0 is always the empty initial document
    if (targetVersion === 0) {
      return { doc: '', version: 0, opsApplied: 0 };
    }

    // Fold: start from empty string, apply ops [0..targetVersion-1]
    let doc = '';
    const opsToApply = this.opLog.slice(0, targetVersion);
    for (const entry of opsToApply) {
      const result = applyOp(doc, entry.op);
      doc = result.doc;
    }

    return { doc, version: targetVersion, opsApplied: opsToApply.length };
  }

  /**
   * Get operation history metadata for a version range.
   * Returns lightweight metadata (no full document content).
   *
   * @param {number} [fromVersion=0] - Start version (inclusive, 1-indexed)
   * @param {number} [toVersion]     - End version (inclusive), defaults to current
   * @returns {Array<{ version, clientId, type, position, textLength, timestamp }>}
   */
  getHistory(fromVersion = 1, toVersion = this.version) {
    const from = Math.max(0, fromVersion - 1); // opLog is 0-indexed
    const to   = Math.min(toVersion, this.version);

    return this.opLog.slice(from, to).map(entry => ({
      version:    entry.version,
      clientId:   entry.clientId,
      type:       entry.op.type,
      position:   entry.op.position,
      textLength: entry.op.type === 'insert' ? entry.op.text.length : entry.op.length,
      text:       entry.op.type === 'insert' ? entry.op.text.slice(0, 80) : null, // truncate for display
      timestamp:  entry.timestamp,
      isUndo:     !!entry.isUndo,
      isRedo:     !!entry.isRedo,
    }));
  }
}

module.exports = { DocumentEngine, SNAPSHOT_INTERVAL };
