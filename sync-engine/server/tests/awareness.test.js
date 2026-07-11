/**
 * Awareness & Reconciliation Tests
 * ==========================================================
 * Tests the server-side presence/typing layer and the
 * reconciliation sweeps that handle ghost connections.
 * ==========================================================
 */

'use strict';

const { 
  getRedisClient,
  setPresenceInRedis,
  getPresenceForDoc,
  getPresenceByServerId,
  deletePresenceByServerId,
  setTypingInRedis,
  clearTypingInRedis,
  getTypingForDoc,
  closeRedis
} = require('../src/redis/client');

// Note: These tests require a running local Redis instance,
// just like the ratelimit tests would.

describe('Awareness & Reconciliation (Redis-backed)', () => {
  const SERVER_ID_1 = 'test-server-1';
  const SERVER_ID_2 = 'test-server-2';
  const DOC_ID = 'test-doc-awareness';
  const USER_1 = 'alice';
  const USER_2 = 'bob';

  // We need to verify Redis is actually connected before running these,
  // otherwise skip them to avoid CI failures if Redis isn't present.
  let isRedisAvailable = false;

  beforeAll(async () => {
    try {
      const client = getRedisClient();
      await client.ping();
      isRedisAvailable = true;
    } catch (e) {
      console.warn('Skipping Redis awareness tests: Redis not available locally.');
    }
  });

  afterAll(async () => {
    if (isRedisAvailable) {
      const client = getRedisClient();
      await client.del(`presence:${DOC_ID}:${USER_1}`);
      await client.del(`presence:${DOC_ID}:${USER_2}`);
      await client.del(`typing:${DOC_ID}:${USER_1}`);
      await client.del(`typing:${DOC_ID}:${USER_2}`);
      await closeRedis();
    }
  });

  beforeEach(async () => {
    if (isRedisAvailable) {
      await deletePresenceByServerId(SERVER_ID_1);
      await deletePresenceByServerId(SERVER_ID_2);
      await clearTypingInRedis(DOC_ID, USER_1);
      await clearTypingInRedis(DOC_ID, USER_2);
    }
  });

  test('startup reconciliation cleans ONLY stale keys from the same server instance', async () => {
    if (!isRedisAvailable) return;

    // Simulate Server 1 crashed leaving Alice behind
    await setPresenceInRedis(DOC_ID, USER_1, SERVER_ID_1, '#ff0000');
    // Simulate Server 2 is healthy and Bob is connected to it
    await setPresenceInRedis(DOC_ID, USER_2, SERVER_ID_2, '#00ff00');

    let presence = await getPresenceForDoc(DOC_ID);
    expect(Object.keys(presence)).toHaveLength(2);
    expect(presence[USER_1].serverId).toBe(SERVER_ID_1);
    expect(presence[USER_2].serverId).toBe(SERVER_ID_2);

    // Server 1 boots up and runs reconciliation
    const cleaned = await deletePresenceByServerId(SERVER_ID_1);
    expect(cleaned).toBe(1);

    // Alice should be gone, Bob should still be there
    presence = await getPresenceForDoc(DOC_ID);
    expect(Object.keys(presence)).toHaveLength(1);
    expect(presence[USER_2]).toBeDefined();
    expect(presence[USER_1]).toBeUndefined();
  });

  test('typing indicators auto-expire based on TTL', async () => {
    if (!isRedisAvailable) return;

    // Set Alice as typing
    await setTypingInRedis(DOC_ID, USER_1);
    
    let typing = await getTypingForDoc(DOC_ID);
    expect(typing).toContain(USER_1);

    // Manually clear typing
    await clearTypingInRedis(DOC_ID, USER_1);
    
    typing = await getTypingForDoc(DOC_ID);
    expect(typing).not.toContain(USER_1);
  });

  test('getPresenceByServerId returns correct entries', async () => {
    if (!isRedisAvailable) return;

    await setPresenceInRedis(DOC_ID, USER_1, SERVER_ID_1, '#ff0000');
    await setPresenceInRedis(DOC_ID, USER_2, SERVER_ID_1, '#00ff00');
    await setPresenceInRedis('other-doc', 'carol', SERVER_ID_2, '#0000ff');

    const entries1 = await getPresenceByServerId(SERVER_ID_1);
    expect(entries1).toHaveLength(2);
    expect(entries1.map(e => e.userId).sort()).toEqual([USER_1, USER_2].sort());

    const entries2 = await getPresenceByServerId(SERVER_ID_2);
    expect(entries2).toHaveLength(1);
    expect(entries2[0].userId).toBe('carol');
  });
});
