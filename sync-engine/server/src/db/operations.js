const { getDb } = require('./pool');

async function saveOp(docId, version, op, clientId) {
  try {
    await getDb().collection('operations').insertOne({
      doc_id: docId,
      version: version,
      op_data: op,
      client_id: clientId,
      created_at: new Date()
    });
  } catch (err) {
    if (err.code !== 11000) throw err; // Ignore duplicate key errors (ON CONFLICT DO NOTHING)
  }
}

async function getOpsSince(docId, sinceVersion) {
  const rows = await getDb().collection('operations')
    .find({ doc_id: docId, version: { $gt: sinceVersion } })
    .sort({ version: 1 })
    .toArray();
  return rows.map(row => ({
    version: row.version,
    op: row.op_data,
    clientId: row.client_id,
    timestamp: row.created_at,
  }));
}

async function getLatestVersion(docId) {
  const row = await getDb().collection('operations')
    .find({ doc_id: docId })
    .sort({ version: -1 })
    .limit(1)
    .toArray();
  return row.length > 0 ? row[0].version : 0;
}

module.exports = { saveOp, getOpsSince, getLatestVersion };
