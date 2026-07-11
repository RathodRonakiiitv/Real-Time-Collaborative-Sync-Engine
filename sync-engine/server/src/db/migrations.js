const { connectMongo, getDb } = require('./pool');

async function runMigrations() {
  await connectMongo();
  const db = getDb();
  await db.collection('operations').createIndex({ doc_id: 1, version: 1 }, { unique: true });
  await db.collection('snapshots').createIndex({ doc_id: 1, version: -1 });
  console.log('[MongoDB] Ensured collections and indexes exist');
}

module.exports = { runMigrations };
