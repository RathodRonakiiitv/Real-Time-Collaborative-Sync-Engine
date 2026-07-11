/**
 * History — Fold-Based Reconstruction Tests
 * ==========================================================
 * Verifies that getDocumentAtVersion() correctly reconstructs
 * the document at every version by folding ops through applyOp().
 *
 * These tests use the in-memory DocumentEngine only (no PostgreSQL),
 * since the fold logic in db/history.js uses the same applyOp()
 * function and is structurally identical.
 * ==========================================================
 */

'use strict';

const { DocumentEngine } = require('../src/ot/engine');

describe('Fold-Based Document Reconstruction', () => {
  let engine;

  beforeEach(() => {
    engine = new DocumentEngine('test-doc', '');
  });

  // ── BASIC FOLD CORRECTNESS ─────────────────────────────

  test('version 0 returns empty document', async () => {
    const result = engine.getDocumentAtVersion(0);
    expect(result.doc).toBe('');
    expect(result.version).toBe(0);
    expect(result.opsApplied).toBe(0);
  });

  test('fold after single insert', async () => {
    await engine.receiveOp({ type: 'insert', position: 0, text: 'Hello', clientId: 'alice' }, 0);

    const atV1 = engine.getDocumentAtVersion(1);
    expect(atV1.doc).toBe('Hello');
    expect(atV1.version).toBe(1);
    expect(atV1.opsApplied).toBe(1);
  });

  test('fold after multiple sequential inserts', async () => {
    await engine.receiveOp({ type: 'insert', position: 0, text: 'Hello', clientId: 'alice' }, 0);
    await engine.receiveOp({ type: 'insert', position: 5, text: ' World', clientId: 'alice' }, 1);
    await engine.receiveOp({ type: 'insert', position: 11, text: '!', clientId: 'alice' }, 2);

    // Check every intermediate version
    expect(engine.getDocumentAtVersion(0).doc).toBe('');
    expect(engine.getDocumentAtVersion(1).doc).toBe('Hello');
    expect(engine.getDocumentAtVersion(2).doc).toBe('Hello World');
    expect(engine.getDocumentAtVersion(3).doc).toBe('Hello World!');
  });

  test('fold after insert + delete', async () => {
    await engine.receiveOp({ type: 'insert', position: 0, text: 'Hello World', clientId: 'alice' }, 0);
    await engine.receiveOp({ type: 'delete', position: 5, length: 6, clientId: 'alice' }, 1);

    expect(engine.getDocumentAtVersion(1).doc).toBe('Hello World');
    expect(engine.getDocumentAtVersion(2).doc).toBe('Hello');
  });

  test('fold matches live document at every version', async () => {
    const ops = [
      { type: 'insert', position: 0, text: 'ABCDE', clientId: 'alice' },
      { type: 'insert', position: 2, text: 'XY', clientId: 'bob' },
      { type: 'delete', position: 1, length: 3, clientId: 'alice' },
      { type: 'insert', position: 0, text: 'Z', clientId: 'bob' },
      { type: 'delete', position: 5, length: 1, clientId: 'alice' },
    ];

    // Apply each op and record the live document state
    const liveStates = [''];
    for (let i = 0; i < ops.length; i++) {
      await engine.receiveOp(ops[i], i);
      liveStates.push(engine.getDocument());
    }

    // Verify fold reconstruction matches live state at every version
    for (let v = 0; v <= ops.length; v++) {
      const folded = engine.getDocumentAtVersion(v);
      expect(folded.doc).toBe(liveStates[v]);
      expect(folded.version).toBe(v);
    }
  });

  // ── CONCURRENT OPS (transformed) ──────────────────────

  test('fold handles transformed concurrent ops', async () => {
    // Alice inserts at position 0
    await engine.receiveOp(
      { type: 'insert', position: 0, text: 'Hello', clientId: 'alice' },
      0
    );

    // Bob also inserts at position 0, based on version 0 (concurrent)
    // The transform should shift Bob's insert to after Alice's
    await engine.receiveOp(
      { type: 'insert', position: 0, text: 'World', clientId: 'bob' },
      0
    );

    // After transform, the server should have applied both ops correctly
    // The fold at version 2 must match the live document
    const live = engine.getDocument();
    const folded = engine.getDocumentAtVersion(2);
    expect(folded.doc).toBe(live);
  });

  // ── EDGE CASES ─────────────────────────────────────────

  test('fold at version > current throws RangeError', async () => {
    expect(() => engine.getDocumentAtVersion(1)).toThrow(RangeError);
    expect(() => engine.getDocumentAtVersion(999)).toThrow(RangeError);
  });

  test('fold at negative version throws RangeError', async () => {
    expect(() => engine.getDocumentAtVersion(-1)).toThrow(RangeError);
  });

  test('fold with unicode text', async () => {
    await engine.receiveOp(
      { type: 'insert', position: 0, text: '🔥 Hello 世界', clientId: 'alice' },
      0
    );
    const result = engine.getDocumentAtVersion(1);
    expect(result.doc).toBe('🔥 Hello 世界');
  });

  // ── HISTORY METADATA ───────────────────────────────────

  test('getHistory returns op metadata', async () => {
    await engine.receiveOp({ type: 'insert', position: 0, text: 'Hello', clientId: 'alice' }, 0);
    await engine.receiveOp({ type: 'delete', position: 3, length: 2, clientId: 'bob' }, 1);

    const history = engine.getHistory();
    expect(history).toHaveLength(2);

    expect(history[0].version).toBe(1);
    expect(history[0].clientId).toBe('alice');
    expect(history[0].type).toBe('insert');
    expect(history[0].textLength).toBe(5);
    expect(history[0].text).toBe('Hello');

    expect(history[1].version).toBe(2);
    expect(history[1].clientId).toBe('bob');
    expect(history[1].type).toBe('delete');
    expect(history[1].textLength).toBe(2);
    expect(history[1].text).toBeNull();
  });

  test('getHistory respects version range', async () => {
    for (let i = 0; i < 10; i++) {
      await engine.receiveOp({ type: 'insert', position: 0, text: `${i}`, clientId: 'alice' }, i);
    }

    const subset = engine.getHistory(3, 7);
    expect(subset).toHaveLength(5);
    expect(subset[0].version).toBe(3);
    expect(subset[4].version).toBe(7);
  });

  // ── STRESS: FOLD CONSISTENCY OVER MANY OPS ─────────────

  test('fold is consistent over 100 random ops', async () => {
    const rng = seededRandom(42);
    const liveStates = [''];

    for (let i = 0; i < 100; i++) {
      const doc = engine.getDocument();
      const isInsert = doc.length === 0 || rng() > 0.4;

      if (isInsert) {
        const pos = Math.floor(rng() * (doc.length + 1));
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
        const len = Math.floor(rng() * 5) + 1;
        let text = '';
        for (let j = 0; j < len; j++) text += chars[Math.floor(rng() * chars.length)];
        await engine.receiveOp({ type: 'insert', position: pos, text, clientId: 'fuzz' }, i);
      } else {
        const pos = Math.floor(rng() * doc.length);
        const maxLen = doc.length - pos;
        const len = Math.min(Math.floor(rng() * 5) + 1, maxLen);
        if (len > 0) {
          await engine.receiveOp({ type: 'delete', position: pos, length: len, clientId: 'fuzz' }, i);
        }
      }
      liveStates.push(engine.getDocument());
    }

    // Spot-check 20 random versions
    for (let i = 0; i < 20; i++) {
      const v = Math.floor(rng() * liveStates.length);
      const folded = engine.getDocumentAtVersion(v);
      expect(folded.doc).toBe(liveStates[v]);
    }
  });
});

// Deterministic PRNG for reproducible fuzz tests (xorshift32)
function seededRandom(seed) {
  let s = seed;
  return function () {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
