/**
 * Token Bucket Rate Limiter (Redis-backed)
 * ==========================================================
 * Prevents operation flooding by limiting ops per client.
 * Uses atomic Redis MULTI/EXEC for thread-safe counters.
 *
 * Algorithm: Fixed window with per-second reset.
 *   - Key: ratelimit:{clientId}:{currentSecond}
 *   - INCR the key, EXPIRE after 2 seconds
 *   - If count > limit, reject the op
 * ==========================================================
 */

'use strict';

const { getRedisClient } = require('./client');

const DEFAULT_OPS_PER_SEC = parseInt(process.env.RATE_LIMIT_OPS_PER_SEC || '30', 10);

/**
 * Check if a client is within the rate limit.
 * @param {string} clientId
 * @param {number} [limit] - Max ops per second (default from env)
 * @returns {{ allowed: boolean, remaining: number, limit: number }}
 */
async function checkRateLimit(clientId, limit = DEFAULT_OPS_PER_SEC) {
  const redis = getRedisClient();
  if (!redis) {
    return { allowed: true, remaining: limit, limit };
  }
  const currentSecond = Math.floor(Date.now() / 1000);
  const key = `ratelimit:${clientId}:${currentSecond}`;

  // Atomic increment + expire
  const pipeline = redis.multi();
  pipeline.incr(key);
  pipeline.expire(key, 2); // TTL = 2s to cover edge of window
  const results = await pipeline.exec();

  const count = results[0][1]; // Result of INCR
  const allowed = count <= limit;
  const remaining = Math.max(0, limit - count);

  return { allowed, remaining, limit };
}

module.exports = { checkRateLimit };
