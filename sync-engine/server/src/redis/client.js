/**
 * Redis Client + Op Cache
 * ==========================================================
 * - Shared Redis client (ioredis)
 * - Op log cache: stores last N ops per document in a Redis
 *   list for fast reconnect catch-up (avoids hitting PostgreSQL)
 * ==========================================================
 */

'use strict';

const Redis = require('ioredis');

const MAX_CACHED_OPS = 200; // Keep last 200 ops per doc in Redis

let redis = null;
let redisAvailable = true;

/**
 * Initialize the Redis client.
 * @param {string} [url] - Redis connection URL (default from env)
 * @returns {Redis}
 */
function getRedisClient(url) {
  if (!redis && redisAvailable) {
    redis = new Redis(url || process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: 1, // Don't block forever
      retryStrategy(times) {
        if (times > 3) {
          redisAvailable = false;
          return null; // Stop retrying
        }
        return Math.min(times * 200, 1000);
      },
      lazyConnect: false,
    });

    redis.on('connect', () => {
      console.log('[Redis] Connected');
      redisAvailable = true;
    });
    redis.on('error', (err) => {
      // Only log first failure — suppress repeat spam when Redis is unavailable
      if (redisAvailable) {
        console.warn('[Redis] Unavailable — running without cache:', err.message);
        redisAvailable = false;
      }
    });
  }
  return redisAvailable ? redis : null;
}

/**
 * Cache an operation for a document.
 * Stores as a JSON string in a Redis list, capped at MAX_CACHED_OPS.
 * @param {string} docId
 * @param {number} version
 * @param {object} op
 */
async function cacheOp(docId, version, op) {
  const client = getRedisClient();
  if (!client) return;
  const key = `oplog:${docId}`;
  const entry = JSON.stringify({ version, op, timestamp: Date.now() });

  await client.rpush(key, entry);
  // Trim to keep only the last MAX_CACHED_OPS entries
  await client.ltrim(key, -MAX_CACHED_OPS, -1);
}

/**
 * Get cached ops since a given version.
 * @param {string} docId
 * @param {number} sinceVersion - Exclusive lower bound
 * @returns {Array<{ version, op, timestamp }>}
 */
async function getCachedOps(docId, sinceVersion) {
  const client = getRedisClient();
  if (!client) return [];
  const key = `oplog:${docId}`;
  const entries = await client.lrange(key, 0, -1);

  return entries
    .map(e => JSON.parse(e))
    .filter(e => e.version > sinceVersion);
}

/**
 * Store the current document state in Redis for fast access.
 * @param {string} docId
 * @param {string} doc     - Document content
 * @param {number} version - Current version
 */
async function cacheDocState(docId, doc, version) {
  const client = getRedisClient();
  if (!client) return;
  await client.hset(`doc:${docId}`, 'content', doc, 'version', version.toString());
}

/**
 * Get cached document state.
 * @param {string} docId
 * @returns {{ content: string, version: number } | null}
 */
async function getCachedDocState(docId) {
  const client = getRedisClient();
  if (!client) return null;
  const data = await client.hgetall(`doc:${docId}`);
  if (!data || !data.content) return null;
  return { content: data.content, version: parseInt(data.version, 10) };
}

/**
 * Gracefully close Redis connection.
 */
async function closeRedis() {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

// ─────────────────────────────────────────────────────────
// CURSOR PRESENCE (ephemeral — short TTL, never persisted)
// ─────────────────────────────────────────────────────────

const CURSOR_TTL_SECONDS = 30; // auto-expires if client ghosts

/**
 * Store a user's cursor position in Redis.
 * Key: cursor:{docId}:{userId}  →  Hash { position, color }
 * TTL: 30s — refreshed on every cursor update.
 * If client disconnects without sending cursor_leave,
 * the key expires automatically after 30 seconds.
 *
 * @param {string} docId
 * @param {string} userId
 * @param {number} position
 * @param {string} color
 */
async function setCursorInRedis(docId, userId, position, color) {
  const client = getRedisClient();
  if (!client) return; // graceful fallback — in-memory Map still works
  const key = `cursor:${docId}:${userId}`;
  await client.hset(key, 'position', position.toString(), 'color', color, 'userId', userId);
  await client.expire(key, CURSOR_TTL_SECONDS);
}

/**
 * Get all active cursors for a document from Redis.
 * Returns an object: { userId: { position, color } }
 *
 * @param {string} docId
 * @returns {Promise<Object>}
 */
async function getCursorsFromRedis(docId) {
  const client = getRedisClient();
  if (!client) return {};

  // Scan for all keys matching cursor:{docId}:*
  const pattern = `cursor:${docId}:*`;
  let cursor = '0';
  const result = {};

  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    for (const key of keys) {
      const data = await client.hgetall(key);
      if (data && data.userId) {
        result[data.userId] = {
          position: parseInt(data.position, 10),
          color:    data.color,
        };
      }
    }
  } while (cursor !== '0');

  return result;
}

/**
 * Remove a user's cursor from Redis on disconnect.
 * @param {string} docId
 * @param {string} userId
 */
async function deleteCursorFromRedis(docId, userId) {
  const client = getRedisClient();
  if (!client) return;
  await client.del(`cursor:${docId}:${userId}`);
}

// ─────────────────────────────────────────────────────────
// PRESENCE (ephemeral — with server instance tagging)
// ─────────────────────────────────────────────────────────
//
// Each presence key stores the server instance ID so that on
// restart, the server can SCAN for keys tagged with its own
// ID and purge them — handling the case where the previous
// process crashed without graceful shutdown.
//
// Key format:   presence:{docId}:{userId}
// Value:        Hash { serverId, userId, docId, color, lastSeen }
// TTL:          60s (refreshed on every cursor/typing update)

const PRESENCE_TTL_SECONDS = 60;

/**
 * Register a user's presence for a document.
 * @param {string} docId
 * @param {string} userId
 * @param {string} serverId  — THIS server's instance ID
 * @param {string} color
 */
async function setPresenceInRedis(docId, userId, serverId, color) {
  const client = getRedisClient();
  if (!client) return;
  const key = `presence:${docId}:${userId}`;
  await client.hset(key,
    'serverId', serverId,
    'userId',   userId,
    'docId',    docId,
    'color',    color,
    'lastSeen', Date.now().toString()
  );
  await client.expire(key, PRESENCE_TTL_SECONDS);
}

/**
 * Get all active users present in a document.
 * @param {string} docId
 * @returns {Promise<Object>}  userId → { color, serverId, lastSeen }
 */
async function getPresenceForDoc(docId) {
  const client = getRedisClient();
  if (!client) return {};

  const pattern = `presence:${docId}:*`;
  let cursor = '0';
  const result = {};

  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    for (const key of keys) {
      const data = await client.hgetall(key);
      if (data && data.userId) {
        result[data.userId] = {
          color:    data.color,
          serverId: data.serverId,
          lastSeen: parseInt(data.lastSeen || '0', 10),
        };
      }
    }
  } while (cursor !== '0');

  return result;
}

/**
 * Get ALL presence keys tagged with a specific server instance ID.
 * Used for startup reconciliation — find all ghosts from our
 * previous incarnation.
 *
 * @param {string} serverId
 * @returns {Promise<Array<{ key, docId, userId }>>}
 */
async function getPresenceByServerId(serverId) {
  const client = getRedisClient();
  if (!client) return [];

  const pattern = 'presence:*';
  let cursor = '0';
  const staleEntries = [];

  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    cursor = nextCursor;
    for (const key of keys) {
      const data = await client.hgetall(key);
      if (data && data.serverId === serverId) {
        staleEntries.push({ key, docId: data.docId, userId: data.userId });
      }
    }
  } while (cursor !== '0');

  return staleEntries;
}

/**
 * Remove a single user's presence from Redis.
 * @param {string} docId
 * @param {string} userId
 */
async function deletePresence(docId, userId) {
  const client = getRedisClient();
  if (!client) return;
  await client.del(`presence:${docId}:${userId}`);
}

/**
 * Bulk-delete ALL presence keys tagged with a specific server ID.
 * Called on startup (purge ghosts from previous crash) and on
 * graceful shutdown (clean exit).
 *
 * @param {string} serverId
 * @returns {Promise<number>}  count of deleted keys
 */
async function deletePresenceByServerId(serverId) {
  const entries = await getPresenceByServerId(serverId);
  if (entries.length === 0) return 0;

  const client = getRedisClient();
  if (!client) return 0;

  const pipeline = client.pipeline();
  for (const entry of entries) {
    pipeline.del(entry.key);
  }
  await pipeline.exec();
  return entries.length;
}

// ─────────────────────────────────────────────────────────
// TYPING INDICATORS (ephemeral — 3s TTL auto-expiry)
// ─────────────────────────────────────────────────────────

const TYPING_TTL_SECONDS = 3;

/**
 * Mark a user as typing in a document.
 * Key auto-expires after 3s — if the user stops typing and
 * the client doesn't send a typing_stop, the indicator
 * disappears on its own.
 *
 * @param {string} docId
 * @param {string} userId
 */
async function setTypingInRedis(docId, userId) {
  const client = getRedisClient();
  if (!client) return;
  const key = `typing:${docId}:${userId}`;
  await client.set(key, '1', 'EX', TYPING_TTL_SECONDS);
}

/**
 * Clear a user's typing indicator.
 * @param {string} docId
 * @param {string} userId
 */
async function clearTypingInRedis(docId, userId) {
  const client = getRedisClient();
  if (!client) return;
  await client.del(`typing:${docId}:${userId}`);
}

/**
 * Get all users currently typing in a document.
 * @param {string} docId
 * @returns {Promise<string[]>}  array of userIds
 */
async function getTypingForDoc(docId) {
  const client = getRedisClient();
  if (!client) return [];

  const pattern = `typing:${docId}:*`;
  let cursor = '0';
  const typingUsers = [];

  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    for (const key of keys) {
      // Extract userId from key: typing:{docId}:{userId}
      const parts = key.split(':');
      typingUsers.push(parts[parts.length - 1]);
    }
  } while (cursor !== '0');

  return typingUsers;
}

module.exports = {
  getRedisClient,
  cacheOp,
  getCachedOps,
  cacheDocState,
  getCachedDocState,
  closeRedis,
  // Cursor presence (ephemeral, multi-server safe via Redis TTL)
  setCursorInRedis,
  getCursorsFromRedis,
  deleteCursorFromRedis,
  // Presence (with server instance tagging for reconciliation)
  setPresenceInRedis,
  getPresenceForDoc,
  getPresenceByServerId,
  deletePresence,
  deletePresenceByServerId,
  // Typing indicators
  setTypingInRedis,
  clearTypingInRedis,
  getTypingForDoc,
};
