/**
 * OT Engine — Operation Schema & Transform Function
 * ==========================================================
 * Implements server-side Operational Transformation (OT) for
 * plain-text collaborative editing (Google Docs model).
 *
 * Operation Schema:
 *   {
 *     type        : 'insert' | 'delete'
 *     position    : number          — 0-based index into document string
 *     text        : string          — content to insert (insert ops only)
 *     length      : number          — chars to remove (delete ops only)
 *     deletedText : string          — captured at apply-time (delete ops, for undo)
 *     clientId    : string          — originating client identifier
 *     version     : number          — document version this op was based on
 *   }
 *
 * Conflict cases handled by transform(op1, op2):
 *   1. insert vs insert
 *   2. insert vs delete
 *   3. delete vs insert
 *   4. delete vs delete
 * ==========================================================
 */

'use strict';

// ─────────────────────────────────────────────────────────
// 1. OPERATION FACTORIES
// ─────────────────────────────────────────────────────────

/**
 * Create an insert operation.
 * @param {number} position  - Insertion index (0-based)
 * @param {string} text      - Text to insert
 * @param {string} clientId  - Originating client
 * @param {number} version   - Document version op is based on
 * @returns {Operation}
 */
function createInsert(position, text, clientId, version) {
  if (typeof position !== 'number' || position < 0) {
    throw new TypeError(`position must be a non-negative number, got: ${position}`);
  }
  if (typeof text !== 'string' || text.length === 0) {
    throw new TypeError(`text must be a non-empty string`);
  }
  return { type: 'insert', position, text, clientId: clientId ?? 'unknown', version: version ?? 0 };
}

/**
 * Create a delete operation.
 * @param {number} position  - Start index of deletion (0-based)
 * @param {number} length    - Number of characters to delete
 * @param {string} clientId  - Originating client
 * @param {number} version   - Document version op is based on
 * @returns {Operation}
 */
function createDelete(position, length, clientId, version) {
  if (typeof position !== 'number' || position < 0) {
    throw new TypeError(`position must be a non-negative number, got: ${position}`);
  }
  if (typeof length !== 'number' || length <= 0) {
    throw new TypeError(`length must be a positive number, got: ${length}`);
  }
  return { type: 'delete', position, length, clientId: clientId ?? 'unknown', version: version ?? 0 };
}

// ─────────────────────────────────────────────────────────
// 2. DOCUMENT APPLICATION
// ─────────────────────────────────────────────────────────

/**
 * Apply an operation to a document string.
 * Pure function — returns a new string, never mutates.
 *
 * For DELETE ops, also returns `deletedText` so the engine can
 * store it in the op log and reconstruct the inverse for undo.
 *
 * @param {string}    doc - Current document content
 * @param {Operation} op  - Operation to apply
 * @returns {{ doc: string, deletedText: string|null }}
 */
function applyOp(doc, op) {
  if (typeof doc !== 'string') throw new TypeError('doc must be a string');

  if (op.type === 'insert') {
    const pos = Math.min(op.position, doc.length);
    return {
      doc:         doc.slice(0, pos) + op.text + doc.slice(pos),
      deletedText: null,
    };
  }

  if (op.type === 'delete') {
    const pos    = Math.min(op.position, doc.length);
    const endPos = Math.min(pos + op.length, doc.length);
    const deletedText = doc.slice(pos, endPos); // capture before removing
    return {
      doc:         doc.slice(0, pos) + doc.slice(endPos),
      deletedText,
    };
  }

  throw new TypeError(`Unknown operation type: ${op.type}`);
}

// ─────────────────────────────────────────────────────────
// 3. TRANSFORM FUNCTION  ← THE HEART OF OT
// ─────────────────────────────────────────────────────────

/**
 * transform(op1, op2)
 *
 * Given two concurrent operations op1 and op2 that were both
 * generated against the *same* document version, return a NEW
 * op2' that can be correctly applied *after* op1 has already
 * been applied.
 *
 * This satisfies the fundamental OT convergence property:
 *   apply(apply(doc, op1), transform(op1, op2))
 *   === apply(apply(doc, op2), transform(op2, op1))
 *
 * Four conflict cases:
 *   Case A: insert vs insert  (op1=insert, op2=insert)
 *   Case B: insert vs delete  (op1=insert, op2=delete)
 *   Case C: delete vs insert  (op1=delete, op2=insert)
 *   Case D: delete vs delete  (op1=delete, op2=delete)
 *
 * Tie-breaking rule for identical positions:
 *   op1 wins (lower clientId string → inserted first alphabetically).
 *   This makes the transform deterministic when position equality occurs.
 *
 * @param {Operation} op1  - The operation already applied to the doc
 * @param {Operation} op2  - The operation to transform
 * @returns {Operation}    - Transformed op2' ready to apply after op1
 */
function transform(op1, op2) {
  // ── Case A: insert vs insert ──────────────────────────────
  // op1 inserted text at op1.position.
  // If op2 wants to insert at or after op1's position,
  // op2's target position has shifted right by op1.text.length.
  //
  // Tie-break: if positions equal AND op1.clientId < op2.clientId,
  // op1 is considered to come first → push op2 right.
  if (op1.type === 'insert' && op2.type === 'insert') {
    if (
      op1.position < op2.position ||
      (op1.position === op2.position && op1.clientId <= op2.clientId)
    ) {
      return { ...op2, position: op2.position + op1.text.length };
    }
    // op1 inserted after op2's target → op2 position unchanged
    return { ...op2 };
  }

  // ── Case B: insert vs delete ──────────────────────────────
  // op1 inserted text at op1.position.
  // op2 wants to delete a range [op2.position, op2.position + op2.length).
  //
  // Three sub-cases:
  //  B1. op1 inserted before the deletion range → shift delete start right
  //  B2. op1 inserted inside the deletion range → extend delete length
  //  B3. op1 inserted after the deletion range  → delete position unchanged
  if (op1.type === 'insert' && op2.type === 'delete') {
    const deleteEnd = op2.position + op2.length;

    if (op1.position <= op2.position) {
      // B1: insert is before or at the delete start
      return { ...op2, position: op2.position + op1.text.length };
    }

    if (op1.position < deleteEnd) {
      // B2: insert falls inside the delete range → extend length
      return { ...op2, length: op2.length + op1.text.length };
    }

    // B3: insert is after the entire delete range → no change
    return { ...op2 };
  }

  // ── Case C: delete vs insert ──────────────────────────────
  // op1 deleted a range [op1.position, op1.position + op1.length).
  // op2 wants to insert at op2.position.
  //
  //  C1. op2 inserts before the deleted range → no shift needed
  //  C2. op2 inserts inside the deleted range → clamp to delete start
  //  C3. op2 inserts after the deleted range  → shift left by delete length
  if (op1.type === 'delete' && op2.type === 'insert') {
    const deleteEnd = op1.position + op1.length;

    if (op2.position <= op1.position) {
      // C1: insert is before or AT the deletion start boundary → unchanged
      // An insert at the exact start of a deleted range is preserved there
      return { ...op2 };
    }

    if (op2.position < deleteEnd) {
      // C2: insert was strictly inside the now-deleted range.
      // The delete already removed this region; the insert is absorbed.
      // This ensures TP1 symmetry with Case B2 (extend-delete policy):
      //   apply(apply(doc, ins), transform(ins, del))
      //   === apply(apply(doc, del), transform(del, ins))
      return null;
    }

    // C3: insert is at or after the end of the deletion range → shift left
    return { ...op2, position: op2.position - op1.length };
  }

  // ── Case D: delete vs delete ──────────────────────────────
  // op1 deleted range R1 = [p1, p1+l1).
  // op2 wants to delete range R2 = [p2, p2+l2).
  //
  // After op1, some characters that op2 wanted to delete may already be gone.
  // We compute the new effective position and length for op2'.
  if (op1.type === 'delete' && op2.type === 'delete') {
    const p1 = op1.position, l1 = op1.length, e1 = p1 + l1; // end of op1 range
    const p2 = op2.position, l2 = op2.length, e2 = p2 + l2; // end of op2 range

    // D1: op2's range is entirely before op1's range → unchanged
    if (e2 <= p1) {
      return { ...op2 };
    }

    // D2: op2's range is entirely after op1's range → shift left
    if (p2 >= e1) {
      return { ...op2, position: p2 - l1 };
    }

    // D3: Ranges overlap — we must shrink op2's range to skip
    //     characters that op1 already deleted.
    //
    //     Adjusted start: max(p2, p1) → if op2 started inside op1's range,
    //       those chars are gone; clamp to p1. Otherwise keep p2.
    //     Adjusted end: We keep only the portion of op2's range that
    //       falls *outside* op1's deletion.

    const newPos    = Math.min(p2, p1);          // new start after clamp
    const overlapStart = Math.max(p1, p2);       // where the overlap begins
    const overlapEnd   = Math.min(e1, e2);       // where the overlap ends
    const overlap      = Math.max(0, overlapEnd - overlapStart);

    // Portion of op2's range that was before op1's range
    const beforeOverlap = Math.max(0, p1 - p2);
    // Portion of op2's range that was after op1's range
    const afterOverlap  = Math.max(0, e2 - e1);

    const newLength = beforeOverlap + afterOverlap;

    if (newLength === 0) {
      // op1 already deleted everything op2 wanted to delete → no-op
      return null; // caller must handle null (skip op)
    }

    return { ...op2, position: newPos, length: newLength };
  }

  throw new TypeError(`Unsupported op type combination: ${op1.type} vs ${op2.type}`);
}

// ─────────────────────────────────────────────────────────
// 5. INVERSE OPERATION  ← needed for per-user selective undo
// ─────────────────────────────────────────────────────────

/**
 * Compute the inverse of an operation.
 *
 * invertOp(insert(pos, text))   → delete(pos, text.length)
 * invertOp(delete(pos, len))    → insert(pos, deletedText)
 *
 * IMPORTANT: For delete ops the inverse needs the original
 * characters that were deleted. These are stored as `deletedText`
 * on the op log entry at apply-time (see DocumentEngine.receiveOp).
 *
 * @param {Operation} op  - Original op (must have .deletedText for deletes)
 * @returns {Operation}   - Inverse op
 */
function invertOp(op) {
  if (op.type === 'insert') {
    // Undo an insert by deleting exactly those characters
    return {
      type:     'delete',
      position: op.position,
      length:   op.text.length,
      clientId: op.clientId,
      version:  op.version,
    };
  }

  if (op.type === 'delete') {
    // Undo a delete by re-inserting the deleted text
    if (!op.deletedText) {
      throw new Error('Cannot invert delete op: deletedText is missing. Was it captured at apply-time?');
    }
    return {
      type:     'insert',
      position: op.position,
      text:     op.deletedText,
      clientId: op.clientId,
      version:  op.version,
    };
  }

  throw new TypeError(`Cannot invert unknown op type: ${op.type}`);
}

// ─────────────────────────────────────────────────────────
// 6. VALIDATION HELPERS
// ─────────────────────────────────────────────────────────

/**
 * Validate that an operation object is structurally correct.
 * Throws a descriptive error if invalid.
 * @param {*} op
 */
function validateOp(op) {
  if (!op || typeof op !== 'object') throw new TypeError('op must be an object');
  if (!['insert', 'delete'].includes(op.type)) {
    throw new TypeError(`op.type must be 'insert' or 'delete', got: '${op.type}'`);
  }
  if (typeof op.position !== 'number' || op.position < 0 || !Number.isInteger(op.position)) {
    throw new TypeError(`op.position must be a non-negative integer, got: ${op.position}`);
  }
  if (op.type === 'insert') {
    if (typeof op.text !== 'string' || op.text.length === 0) {
      throw new TypeError('insert op must have a non-empty string .text');
    }
  }
  if (op.type === 'delete') {
    if (typeof op.length !== 'number' || op.length <= 0 || !Number.isInteger(op.length)) {
      throw new TypeError('delete op must have a positive integer .length');
    }
  }
}

/**
 * Apply a sequence of operations to a document.
 * Returns the final document string.
 * @param {string}      doc
 * @param {Operation[]} ops
 * @returns {string}
 */
function applyAll(doc, ops) {
  return ops.reduce((current, op) => {
    if (op === null) return current;
    const result = applyOp(current, op);
    return result.doc;
  }, doc);
}

// ─────────────────────────────────────────────────────────
// 7. EXPORTS
// ─────────────────────────────────────────────────────────

module.exports = {
  createInsert,
  createDelete,
  applyOp,
  applyAll,
  transform,
  validateOp,
  invertOp,
};

