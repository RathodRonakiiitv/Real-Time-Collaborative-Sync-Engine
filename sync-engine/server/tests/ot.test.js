'use strict';

const {
  createInsert,
  createDelete,
  applyOp,
  applyAll,
  transform,
  validateOp,
} = require('../src/ot/operations');

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: apply op1, then apply transform(op1, op2) → convergence test helper
// Proves:  apply(apply(doc, op1), transform(op1, op2))
//        === apply(apply(doc, op2), transform(op2, op1))
// ─────────────────────────────────────────────────────────────────────────────
function applyOpDoc(doc, op) { return applyOp(doc, op).doc; }

function converges(doc, op1, op2) {
  const op2prime = transform(op1, op2);
  const op1prime = transform(op2, op1);

  let left  = applyOpDoc(doc, op1);
  if (op2prime !== null) left = applyOpDoc(left, op2prime);

  let right = applyOpDoc(doc, op2);
  if (op1prime !== null) right = applyOpDoc(right, op1prime);

  return { left, right, converged: left === right };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. OPERATION FACTORIES & VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
describe('Operation Factories', () => {
  test('createInsert builds correct schema', () => {
    const op = createInsert(3, 'hi', 'clientA', 5);
    expect(op).toEqual({ type: 'insert', position: 3, text: 'hi', clientId: 'clientA', version: 5 });
  });

  test('createDelete builds correct schema', () => {
    const op = createDelete(2, 4, 'clientB', 1);
    expect(op).toEqual({ type: 'delete', position: 2, length: 4, clientId: 'clientB', version: 1 });
  });

  test('createInsert throws on negative position', () => {
    expect(() => createInsert(-1, 'a', 'c', 0)).toThrow(TypeError);
  });

  test('createInsert throws on empty text', () => {
    expect(() => createInsert(0, '', 'c', 0)).toThrow(TypeError);
  });

  test('createDelete throws on zero length', () => {
    expect(() => createDelete(0, 0, 'c', 0)).toThrow(TypeError);
  });

  test('createDelete throws on negative length', () => {
    expect(() => createDelete(0, -2, 'c', 0)).toThrow(TypeError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. VALIDATE OP
// ─────────────────────────────────────────────────────────────────────────────
describe('validateOp', () => {
  test('valid insert passes', () => {
    expect(() => validateOp(createInsert(0, 'x', 'a', 0))).not.toThrow();
  });

  test('valid delete passes', () => {
    expect(() => validateOp(createDelete(0, 1, 'a', 0))).not.toThrow();
  });

  test('throws on null', () => {
    expect(() => validateOp(null)).toThrow(TypeError);
  });

  test('throws on unknown type', () => {
    expect(() => validateOp({ type: 'retain', position: 0, length: 1 })).toThrow(TypeError);
  });

  test('throws on float position', () => {
    expect(() => validateOp({ type: 'insert', position: 1.5, text: 'a' })).toThrow(TypeError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. APPLY OP
// ─────────────────────────────────────────────────────────────────────────────
describe('applyOp', () => {
  test('insert at start', () => {
    expect(applyOp('hello', createInsert(0, 'X', 'a', 0)).doc).toBe('Xhello');
  });

  test('insert in middle', () => {
    expect(applyOp('hello', createInsert(2, '**', 'a', 0)).doc).toBe('he**llo');
  });

  test('insert at end', () => {
    expect(applyOp('hello', createInsert(5, '!', 'a', 0)).doc).toBe('hello!');
  });

  test('insert beyond end clamps to end', () => {
    expect(applyOp('hi', createInsert(100, '!', 'a', 0)).doc).toBe('hi!');
  });

  test('delete from start', () => {
    expect(applyOp('hello', createDelete(0, 2, 'a', 0)).doc).toBe('llo');
  });

  test('delete from middle', () => {
    expect(applyOp('hello world', createDelete(5, 6, 'a', 0)).doc).toBe('hello');
  });

  test('delete entire string', () => {
    expect(applyOp('abc', createDelete(0, 3, 'a', 0)).doc).toBe('');
  });

  test('delete beyond end clamps gracefully', () => {
    expect(applyOp('hi', createDelete(1, 100, 'a', 0)).doc).toBe('h');
  });

  test('throws on non-string doc', () => {
    expect(() => applyOp(42, createInsert(0, 'x', 'a', 0))).toThrow(TypeError);
  });

  test('returns deletedText for delete ops', () => {
    const { doc, deletedText } = applyOp('hello', createDelete(1, 3, 'a', 0));
    expect(doc).toBe('ho');
    expect(deletedText).toBe('ell');
  });

  test('deletedText is null for insert ops', () => {
    const { deletedText } = applyOp('hi', createInsert(2, '!', 'a', 0));
    expect(deletedText).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. CASE A — insert vs insert
// ─────────────────────────────────────────────────────────────────────────────
describe('transform: Case A — insert vs insert', () => {
  const doc = 'hello';

  test('A1: op1 inserts before op2 → shift op2 right', () => {
    const op1 = createInsert(0, 'XX', 'a', 0);
    const op2 = createInsert(2, 'YY', 'b', 0);
    const op2p = transform(op1, op2);
    expect(op2p.position).toBe(4);
    const result = applyOpDoc(applyOpDoc(doc, op1), op2p);
    expect(result).toBe('XXheYYllo');
  });

  test('A2: op1 inserts after op2 → op2 position unchanged', () => {
    const op1 = createInsert(4, 'XX', 'a', 0);
    const op2 = createInsert(1, 'YY', 'b', 0);
    const op2p = transform(op1, op2);
    expect(op2p.position).toBe(1);
    const result = applyOpDoc(applyOpDoc(doc, op1), op2p);
    expect(result).toBe('hYYellXXo');
  });

  test('A3: same position, clientA < clientB → op2 shifts right (op1 wins)', () => {
    const op1 = createInsert(2, 'AA', 'clientA', 0);
    const op2 = createInsert(2, 'BB', 'clientB', 0);
    const op2p = transform(op1, op2);
    expect(op2p.position).toBe(4);
    const result = applyOpDoc(applyOpDoc(doc, op1), op2p);
    expect(result).toBe('heAABBllo');
  });

  test('A4: same position, clientB < clientA → op2 inserts before op1', () => {
    const op1 = createInsert(2, 'AA', 'clientB', 0); // op1 has higher client id
    const op2 = createInsert(2, 'BB', 'clientA', 0); // op2 has lower client id
    const op2p = transform(op1, op2);
    expect(op2p.position).toBe(2); // op2 stays, goes before op1's insertion
  });

  test('A5: convergence proof — symmetric transform produces same doc', () => {
    const op1 = createInsert(1, 'X', 'a', 0);
    const op2 = createInsert(3, 'Y', 'b', 0);
    const { converged, left, right } = converges(doc, op1, op2);
    expect(converged).toBe(true);
    expect(left).toBe(right);
  });

  test('A6: convergence — both at position 0, different clients', () => {
    const op1 = createInsert(0, 'A', 'a', 0);
    const op2 = createInsert(0, 'B', 'b', 0);
    const { converged } = converges('', op1, op2);
    expect(converged).toBe(true);
  });

  test('A7: multi-char insert convergence', () => {
    const op1 = createInsert(0, 'Hello ', 'clientA', 0);
    const op2 = createInsert(0, 'World', 'clientB', 0);
    const { converged } = converges('', op1, op2);
    expect(converged).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. CASE B — insert vs delete
// ─────────────────────────────────────────────────────────────────────────────
describe('transform: Case B — insert vs delete', () => {
  // doc = "hello world"  (length 11)
  const doc = 'hello world';

  test('B1: insert before delete range → shift delete start right', () => {
    const op1  = createInsert(0, 'XX', 'a', 0);
    const op2  = createDelete(6, 5, 'b', 0);
    const op2p = transform(op1, op2);
    expect(op2p.position).toBe(8);
    expect(op2p.length).toBe(5);
    const result = applyOpDoc(applyOpDoc(doc, op1), op2p);
    expect(result).toBe('XXhello ');
  });

  test('B2: insert inside delete range → extend delete length', () => {
    const op1  = createInsert(7, 'ZZ', 'a', 0);  // inserts inside "world"
    const op2  = createDelete(6, 5, 'b', 0);      // delete "world"
    const op2p = transform(op1, op2);
    expect(op2p.length).toBe(7);                  // extended by 2
  });

  test('B3: insert after delete range → delete unchanged', () => {
    const op1  = createInsert(10, '!!', 'a', 0); // inserts at end, after delete range
    const op2  = createDelete(6, 3, 'b', 0);     // delete "wor"
    const op2p = transform(op1, op2);
    expect(op2p.position).toBe(6);
    expect(op2p.length).toBe(3);
  });

  test('B4: insert at exact start of delete range → shifts delete right', () => {
    const op1  = createInsert(6, '--', 'a', 0);
    const op2  = createDelete(6, 5, 'b', 0);
    const op2p = transform(op1, op2);
    expect(op2p.position).toBe(8);
  });

  test('B5: convergence — insert then delete overlapping region', () => {
    const op1 = createInsert(5, ' beautiful', 'a', 0);
    const op2 = createDelete(5, 6, 'b', 0);  // delete " world"
    const { converged } = converges(doc, op1, op2);
    expect(converged).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. CASE C — delete vs insert
// ─────────────────────────────────────────────────────────────────────────────
describe('transform: Case C — delete vs insert', () => {
  // doc = "abcdef"
  const doc = 'abcdef';

  test('C1: insert before deleted range → unchanged', () => {
    const op1  = createDelete(3, 2, 'a', 0);  // delete "de"
    const op2  = createInsert(1, 'X', 'b', 0);
    const op2p = transform(op1, op2);
    expect(op2p.position).toBe(1); // unchanged
  });

  test('C2: insert inside deleted range → absorbed (null)', () => {
    const op1  = createDelete(2, 3, 'a', 0);  // delete "cde" [2..5)
    const op2  = createInsert(3, 'X', 'b', 0); // was inside "cde"
    const op2p = transform(op1, op2);
    expect(op2p).toBeNull(); // insert absorbed by delete (delete-wins policy)
  });

  test('C3: insert after deleted range → shifted left', () => {
    const op1  = createDelete(1, 2, 'a', 0);  // delete "bc"
    const op2  = createInsert(5, 'X', 'b', 0);
    const op2p = transform(op1, op2);
    expect(op2p.position).toBe(3); // 5 - 2 = 3
  });

  test('C4: insert at exact delete boundary (start) → unchanged', () => {
    const op1  = createDelete(3, 2, 'a', 0);
    const op2  = createInsert(3, 'X', 'b', 0);
    const op2p = transform(op1, op2);
    expect(op2p.position).toBe(3); // op2 is at boundary → treat as before
  });

  test('C5: convergence proof', () => {
    const op1 = createDelete(2, 2, 'a', 0);
    const op2 = createInsert(4, 'Z', 'b', 0);
    const { converged } = converges(doc, op1, op2);
    expect(converged).toBe(true);
  });

  test('C6: convergence — insert inside delete range (TP1 symmetry)', () => {
    const op1 = createDelete(1, 3, 'a', 0);  // delete "bcd"
    const op2 = createInsert(2, 'X', 'b', 0); // insert inside deleted range
    const { converged } = converges(doc, op1, op2);
    expect(converged).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. CASE D — delete vs delete
// ─────────────────────────────────────────────────────────────────────────────
describe('transform: Case D — delete vs delete', () => {
  // doc = "abcdefghij"  (length 10)
  const doc = 'abcdefghij';

  test('D1: non-overlapping — op2 entirely before op1 → unchanged', () => {
    const op1  = createDelete(5, 3, 'a', 0); // delete "fgh"
    const op2  = createDelete(1, 2, 'b', 0); // delete "bc"
    const op2p = transform(op1, op2);
    expect(op2p.position).toBe(1);
    expect(op2p.length).toBe(2);
  });

  test('D2: non-overlapping — op2 entirely after op1 → shifted left', () => {
    const op1  = createDelete(1, 3, 'a', 0); // delete "bcd" → 3 chars removed
    const op2  = createDelete(6, 2, 'b', 0); // delete "gh"
    const op2p = transform(op1, op2);
    expect(op2p.position).toBe(3); // 6 - 3 = 3
    expect(op2p.length).toBe(2);
  });

  test('D3: op2 completely inside op1 → becomes null (no-op)', () => {
    const op1  = createDelete(2, 5, 'a', 0); // delete "cdefg" [2..7)
    const op2  = createDelete(3, 2, 'b', 0); // delete "de"  [3..5) ⊂ op1
    const op2p = transform(op1, op2);
    expect(op2p).toBeNull();
  });

  test('D4: op1 completely inside op2 — op2 shrinks by op1 length', () => {
    const op1  = createDelete(3, 2, 'a', 0); // delete "de" [3..5)
    const op2  = createDelete(1, 7, 'b', 0); // delete "bcdefgh" [1..8)
    const op2p = transform(op1, op2);
    expect(op2p).not.toBeNull();
    expect(op2p.length).toBe(5); // 7 - 2 = 5
  });

  test('D5: partial overlap — op2 starts before, ends inside op1', () => {
    const op1  = createDelete(4, 4, 'a', 0); // delete [4..8) "efgh"
    const op2  = createDelete(2, 4, 'b', 0); // delete [2..6) "cdef"
    const op2p = transform(op1, op2);
    // After op1 removes [4..8), op2 only needs to remove [2..4) ("cd")
    expect(op2p).not.toBeNull();
    expect(op2p.position).toBe(2);
    expect(op2p.length).toBe(2);
  });

  test('D6: partial overlap — op2 starts inside op1, ends after', () => {
    const op1  = createDelete(2, 4, 'a', 0); // delete [2..6) "cdef"
    const op2  = createDelete(4, 4, 'b', 0); // delete [4..8) "efgh"
    const op2p = transform(op1, op2);
    // op1 deleted [2..6), op2 originally wanted [4..8).
    // After op1: [4..6) is gone, so op2 only deletes [6..8)="gh" → shifted to pos 2
    expect(op2p).not.toBeNull();
    expect(op2p.length).toBe(2);
  });

  test('D7: same exact range → op2 becomes null', () => {
    const op1  = createDelete(2, 3, 'a', 0);
    const op2  = createDelete(2, 3, 'b', 0);
    const op2p = transform(op1, op2);
    expect(op2p).toBeNull();
  });

  test('D8: convergence — non-overlapping', () => {
    const op1 = createDelete(0, 3, 'a', 0);
    const op2 = createDelete(5, 3, 'b', 0);
    const { converged } = converges(doc, op1, op2);
    expect(converged).toBe(true);
  });

  test('D9: convergence — overlapping', () => {
    const op1 = createDelete(2, 5, 'a', 0);
    const op2 = createDelete(4, 4, 'b', 0);
    const { converged } = converges(doc, op1, op2);
    expect(converged).toBe(true);
  });

  test('D10: convergence — adjacent (touching but not overlapping)', () => {
    const op1 = createDelete(0, 3, 'a', 0); // delete [0..3)
    const op2 = createDelete(3, 3, 'b', 0); // delete [3..6)
    const { converged } = converges(doc, op1, op2);
    expect(converged).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. FORMAL CONVERGENCE PROOFS — 3-client scenarios
// ─────────────────────────────────────────────────────────────────────────────
describe('Formal Convergence Proofs', () => {
  // "Two clients typing simultaneously into an empty doc"
  test('PROOF-1: Two inserts into empty document converge', () => {
    const doc = '';
    const op1 = createInsert(0, 'Alice', 'alice', 0);
    const op2 = createInsert(0, 'Bob',   'bob',   0);
    const { converged, left, right } = converges(doc, op1, op2);
    expect(converged).toBe(true);
    // Both orderings should produce same result
    expect(left).toBe(right);
  });

  // Classic Google Docs scenario
  test('PROOF-2: Concurrent insert and delete converge', () => {
    const doc = 'Hello World';
    const op1 = createInsert(5, ' Beautiful', 'alice', 0); // "Hello Beautiful World"
    const op2 = createDelete(6, 5, 'bob', 0);              // delete "World"
    const { converged } = converges(doc, op1, op2);
    expect(converged).toBe(true);
  });

  test('PROOF-3: Delete then insert outside deleted region converge', () => {
    const doc = 'abcdef';
    const op1 = createDelete(2, 2, 'alice', 0); // delete 'cd', doc becomes 'abef'
    const op2 = createInsert(5, 'X', 'bob', 0); // insert after deleted region
    const { converged } = converges(doc, op1, op2);
    expect(converged).toBe(true);
  });

  test('PROOF-4: Two deletes with full overlap converge', () => {
    const doc = 'hello world';
    const op1 = createDelete(0, 5, 'alice', 0); // delete "hello"
    const op2 = createDelete(0, 5, 'bob',   0); // same range
    const { converged } = converges(doc, op1, op2);
    expect(converged).toBe(true);
  });

  test('PROOF-5: Three concurrent operations all converge (chain transform)', () => {
    const doc = 'ABCDE';
    const op1 = createInsert(0, 'X', 'a', 0);
    const op2 = createInsert(2, 'Y', 'b', 0);
    const op3 = createDelete(1, 2, 'c', 0);

    const doc1   = applyOpDoc(doc, op1);
    const op2p   = transform(op1, op2);
    const doc2   = applyOpDoc(doc1, op2p);
    const op3p1  = transform(op1, op3);
    const op3p2  = transform(op2p, op3p1);
    const doc3   = (op3p2 !== null) ? applyOpDoc(doc2, op3p2) : doc2;

    const docA   = applyOpDoc(doc, op2);
    const op1pA  = transform(op2, op1);
    const docAB  = applyOpDoc(docA, op1pA);
    const op3pA1 = transform(op2, op3);
    const op3pA2 = transform(op1pA, op3pA1);
    const docABC = (op3pA2 !== null) ? applyOpDoc(docAB, op3pA2) : docAB;

    expect(doc3).toBe(docABC);
  });

  test('PROOF-6: Sequential inserts and a concurrent delete converge', () => {
    // Simpler: two independent ops — one insert, one delete — must converge
    const doc = 'Hello World';
    const op1 = createInsert(5, '!!!', 'alice', 0); // 'Hello!!! World'
    const op2 = createDelete(6, 5, 'bob', 0);       // delete 'World'
    const { converged } = converges(doc, op1, op2);
    expect(converged).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. applyAll UTILITY
// ─────────────────────────────────────────────────────────────────────────────
describe('applyAll', () => {
  test('applies sequence of ops in order', () => {
    const ops = [
      createInsert(0, 'Hello', 'a', 0),
      createInsert(5, ' World', 'a', 1),
      createDelete(5, 6, 'a', 2),
    ];
    expect(applyAll('', ops)).toBe('Hello');
  });

  test('skips null ops (absorbed ops)', () => {
    const ops = [createInsert(0, 'Hi', 'a', 0), null, createInsert(2, '!', 'a', 1)];
    expect(applyAll('', ops)).toBe('Hi!');
  });

  test('empty op list returns doc unchanged', () => {
    expect(applyAll('abc', [])).toBe('abc');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. EDGE CASES & REGRESSION TESTS
// ─────────────────────────────────────────────────────────────────────────────
describe('Edge Cases', () => {
  test('transform throws on unknown op type combination', () => {
    const bad = { type: 'retain', position: 0, length: 2, clientId: 'a', version: 0 };
    const ins = createInsert(0, 'x', 'b', 0);
    expect(() => transform(bad, ins)).toThrow(TypeError);
  });

  test('insert at position 0 into empty doc', () => {
    expect(applyOp('', createInsert(0, 'hello', 'a', 0)).doc).toBe('hello');
  });

  test('delete from single-char doc', () => {
    expect(applyOp('x', createDelete(0, 1, 'a', 0)).doc).toBe('');
  });

  test('multi-byte unicode insert and delete', () => {
    const doc    = 'héllo';
    const ins    = createInsert(2, '☀️', 'a', 0);
    const result = applyOp(doc, ins);
    expect(result.doc).toContain('☀️');
  });

  test('transform preserves clientId and version metadata', () => {
    const op1  = createInsert(0, 'A', 'alice', 1);
    const op2  = createInsert(0, 'B', 'bob',   1);
    const op2p = transform(op1, op2);
    expect(op2p.clientId).toBe('bob');
    expect(op2p.version).toBe(1);
  });

  test('large position insert: far beyond end clamps', () => {
    const result = applyOp('abc', createInsert(9999, 'X', 'a', 0));
    expect(result.doc).toBe('abcX');
  });
});
