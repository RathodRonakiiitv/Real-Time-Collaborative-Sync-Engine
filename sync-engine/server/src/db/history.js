const { getDb } = require('./pool');
const { applyOp } = require('../ot/operations');

async function getSnapshotAtOrBefore(docId, targetVersion) {
  const row = await getDb().collection('snapshots')
    .find({ doc_id: docId, version: { $lte: targetVersion } })
    .sort({ version: -1 })
    .limit(1)
    .toArray();
  if (row.length === 0) return null;
  return { version: row[0].version, content: row[0].content };
}

async function getOpsRange(docId, fromVersion, toVersion) {
  const rows = await getDb().collection('operations')
    .find({ doc_id: docId, version: { $gt: fromVersion, $lte: toVersion } })
    .sort({ version: 1 })
    .toArray();
  return rows.map(row => ({
    version: row.version,
    op: row.op_data,
    clientId: row.client_id,
    timestamp: row.created_at,
  }));
}

async function foldDocument(docId, targetVersion) {
  if (targetVersion < 0) throw new RangeError(`targetVersion must be non-negative, got: ${targetVersion}`);
  if (targetVersion === 0) return { doc: '', version: 0, opsApplied: 0, foldedFromSnapshot: false };

  const snapshot = await getSnapshotAtOrBefore(docId, targetVersion);
  let doc = '';
  let startVersion = 0;
  let foldedFromSnapshot = false;

  if (snapshot) {
    doc = snapshot.content;
    startVersion = snapshot.version;
    foldedFromSnapshot = true;
  }

  const ops = await getOpsRange(docId, startVersion, targetVersion);
  for (const entry of ops) {
    const result = applyOp(doc, entry.op);
    doc = result.doc;
  }

  return { doc, version: targetVersion, opsApplied: ops.length, foldedFromSnapshot };
}

async function getPersistedHistory(docId, limit = 100, offset = 0) {
  const db = getDb();
  const total = await db.collection('operations').countDocuments({ doc_id: docId });
  const rows = await db.collection('operations')
    .find({ doc_id: docId })
    .sort({ version: -1 })
    .skip(offset)
    .limit(limit)
    .toArray();

  const ops = rows.map(row => ({
    version: row.version,
    clientId: row.client_id,
    type: row.op_data.type,
    position: row.op_data.position,
    textLength: row.op_data.type === 'insert' ? (row.op_data.text || '').length : (row.op_data.length || 0),
    text: row.op_data.type === 'insert' ? (row.op_data.text || '').slice(0, 80) : null,
    timestamp: row.created_at,
  }));

  return { ops, total };
}

module.exports = { getSnapshotAtOrBefore, getOpsRange, foldDocument, getPersistedHistory };
