const { getDb } = require('./pool');

async function saveSnapshot(docId, version, content) {
  await getDb().collection('snapshots').insertOne({
    doc_id: docId,
    version: version,
    content: content,
    created_at: new Date()
  });
  console.log(`[Snapshot] Saved snapshot for doc=${docId} at version=${version}`);
}

async function getLatestSnapshot(docId) {
  const row = await getDb().collection('snapshots')
    .find({ doc_id: docId })
    .sort({ version: -1 })
    .limit(1)
    .toArray();
  if (row.length === 0) return null;
  return { version: row[0].version, content: row[0].content };
}

module.exports = { saveSnapshot, getLatestSnapshot };
