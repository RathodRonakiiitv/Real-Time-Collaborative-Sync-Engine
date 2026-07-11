const { MongoClient } = require('mongodb');

let db = null;
let client = null;

async function connectMongo() {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/syncengine';
  client = new MongoClient(uri);
  await client.connect();
  db = client.db();
  console.log('[MongoDB] Connected to database');
  return db;
}

function getDb() {
  if (!db) throw new Error('MongoDB not initialized');
  return db;
}

async function closeMongo() {
  if (client) await client.close();
}

module.exports = { connectMongo, getDb, closeMongo };
