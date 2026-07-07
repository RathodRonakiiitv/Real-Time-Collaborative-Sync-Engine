/**
 * WebSocket Server — Room Management & Real-Time Sync
 * ==========================================================
 * Manages document "rooms" — each document has a set of
 * connected WebSocket clients. Handles:
 *   - join       → client joins a document room
 *   - op         → client sends an operation
 *   - cursor     → client broadcasts cursor position (ephemeral)
 *   - reconnect  → client sends buffered ops after disconnect
 *   - auth       → JWT validation on connection
 *   - rate limit → Token Bucket via Redis
 *   - heartbeat  → ping/pong for stale connection detection
 *
 * Message Protocol (JSON):
 *   Client → Server:
 *     { type: 'auth',      token }
 *     { type: 'join',      docId }
 *     { type: 'op',        docId, op, version }
 *     { type: 'cursor',    docId, position }
 *     { type: 'reconnect', docId, baseVersion, bufferedOps }
 *
 *   Server → Client:
 *     { type: 'auth_ok',      userId }
 *     { type: 'auth_error',   message }
 *     { type: 'joined',       docId, doc, version, cursors }
 *     { type: 'sync',         docId, op, version, clientId }
 *     { type: 'cursor_move',  docId, userId, position, color }
 *     { type: 'cursor_leave', docId, userId }
 *     { type: 'catch_up',     docId, ops, version }
 *     { type: 'error',        message, code }
 *     { type: 'rate_limited', message, retryAfterMs }
 * ==========================================================
 */

'use strict';

const { WebSocketServer } = require('ws');
const { DocumentEngine }  = require('../ot/engine');
const { verifyToken }     = require('../auth/jwt');
const { checkRateLimit }  = require('../redis/ratelimit');
const { cacheOp, getCachedOps, cacheDocState, getCachedDocState } = require('../redis/client');
const { saveOp, getOpsSince: getOpsSinceDb } = require('../db/operations');
const { saveSnapshot, getLatestSnapshot }     = require('../db/snapshots');

const HEARTBEAT_INTERVAL = 30000; // 30s ping interval

// ─────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────

/** @type {Map<string, DocumentEngine>} docId → engine */
const engines = new Map();

/** @type {Map<string, Set<WebSocket>>} docId → connected clients */
const rooms = new Map();

/** @type {Map<WebSocket, { userId: string, authenticated: boolean, docs: Set<string> }>} */
const clients = new Map();

/**
 * Ephemeral cursor presence — NOT persisted, lost on server restart.
 * Structure: docId → Map<userId, { position: number, color: string }>
 * @type {Map<string, Map<string, { position: number, color: string }>>}
 */
const cursors = new Map();

// Deterministic color palette — each user gets a consistent color
const CURSOR_COLORS = [
  '#f87171', // red
  '#fb923c', // orange
  '#facc15', // yellow
  '#34d399', // green
  '#38bdf8', // blue
  '#a78bfa', // purple
  '#f472b6', // pink
  '#2dd4bf', // teal
];

/** Assign a color to a userId deterministically */
function getUserColor(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}

// ─────────────────────────────────────────────────────────
// ENGINE MANAGEMENT
// ─────────────────────────────────────────────────────────

/**
 * Get or create a DocumentEngine for a document.
 * Attempts to load from Redis cache first, then PostgreSQL snapshot.
 * @param {string} docId
 * @returns {Promise<DocumentEngine>}
 */
async function getOrCreateEngine(docId) {
  if (engines.has(docId)) return engines.get(docId);

  const persistence = { saveOp, cacheOp, cacheDocState, saveSnapshot };
  const engine = new DocumentEngine(docId, '', persistence);

  // Try loading from snapshot + replaying ops
  try {
    const snapshot = await getLatestSnapshot(docId);
    if (snapshot) {
      const ops = await getOpsSinceDb(docId, snapshot.version);
      engine.loadFromSnapshot(snapshot.content, snapshot.version, ops);
    }
  } catch (err) {
    console.error(`[WS] Failed to load doc=${docId} from persistence:`, err.message);
  }

  engines.set(docId, engine);
  return engine;
}

// ─────────────────────────────────────────────────────────
// MESSAGE HANDLERS
// ─────────────────────────────────────────────────────────

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(docId, msg, excludeWs = null) {
  const room = rooms.get(docId);
  if (!room) return;
  const payload = JSON.stringify(msg);
  for (const ws of room) {
    if (ws !== excludeWs && ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

async function handleAuth(ws, data) {
  try {
    const decoded = verifyToken(data.token);
    const clientInfo = clients.get(ws);
    clientInfo.userId = decoded.userId;
    clientInfo.authenticated = true;
    send(ws, { type: 'auth_ok', userId: decoded.userId });
  } catch (err) {
    send(ws, { type: 'auth_error', message: err.message });
    ws.close(4001, 'Authentication failed');
  }
}

async function handleJoin(ws, data) {
  const clientInfo = clients.get(ws);
  if (!clientInfo.authenticated) {
    send(ws, { type: 'error', message: 'Not authenticated', code: 'AUTH_REQUIRED' });
    return;
  }

  const { docId } = data;
  if (!docId || typeof docId !== 'string') {
    send(ws, { type: 'error', message: 'docId is required', code: 'INVALID_DOC_ID' });
    return;
  }

  const engine = await getOrCreateEngine(docId);

  // Add to room
  if (!rooms.has(docId)) rooms.set(docId, new Set());
  rooms.get(docId).add(ws);
  clientInfo.docs.add(docId);

  // Send joined message with current cursor state of all peers
  const docCursors = cursors.get(docId) || new Map();
  const cursorSnapshot = {};
  for (const [uid, cur] of docCursors) {
    if (uid !== clientInfo.userId) cursorSnapshot[uid] = cur;
  }

  send(ws, {
    type:    'joined',
    docId,
    doc:     engine.getDocument(),
    version: engine.getVersion(),
    cursors: cursorSnapshot,  // existing peers' cursors
  });

  console.log(`[WS] Client ${clientInfo.userId} joined doc=${docId} (${rooms.get(docId).size} clients)`);
}

async function handleOp(ws, data) {
  const clientInfo = clients.get(ws);
  if (!clientInfo.authenticated) {
    send(ws, { type: 'error', message: 'Not authenticated', code: 'AUTH_REQUIRED' });
    return;
  }

  const { docId, op, version } = data;

  // Rate limit check
  const rateResult = await checkRateLimit(clientInfo.userId);
  if (!rateResult.allowed) {
    send(ws, {
      type: 'rate_limited',
      message: `Rate limit exceeded (${rateResult.limit} ops/sec)`,
      retryAfterMs: 1000,
    });
    return;
  }

  const engine = engines.get(docId);
  if (!engine) {
    send(ws, { type: 'error', message: `Not joined to doc ${docId}`, code: 'NOT_IN_ROOM' });
    return;
  }

  try {
    // Stamp the op with the client's userId
    const stampedOp = { ...op, clientId: clientInfo.userId };
    const result = await engine.receiveOp(stampedOp, version);

    if (result.transformedOp) {
      // Send ack to the originating client
      send(ws, {
        type:     'ack',
        docId,
        version:  result.newVersion,
      });

      // Broadcast to all other clients in the room
      broadcast(docId, {
        type:     'sync',
        docId,
        op:       result.transformedOp,
        version:  result.newVersion,
        clientId: clientInfo.userId,
      }, ws);
    } else {
      // Op was absorbed — just ack with current version
      send(ws, { type: 'ack', docId, version: result.newVersion });
    }
  } catch (err) {
    console.error(`[WS] Op error doc=${docId}:`, err.message);
    send(ws, { type: 'error', message: err.message, code: 'OP_ERROR' });
  }
}

/**
 * Handle a cursor position update from a client.
 * Ephemeral — broadcast to peers but never saved to DB or Redis.
 */
function handleCursor(ws, data) {
  const clientInfo = clients.get(ws);
  if (!clientInfo || !clientInfo.authenticated) return;

  const { docId, position } = data;
  if (typeof position !== 'number' || position < 0) return;
  if (!rooms.has(docId)) return;

  const color = getUserColor(clientInfo.userId);

  // Update in-memory cursor state
  if (!cursors.has(docId)) cursors.set(docId, new Map());
  cursors.get(docId).set(clientInfo.userId, { position, color });

  // Broadcast to all OTHER clients in the same room
  broadcast(docId, {
    type:     'cursor_move',
    docId,
    userId:   clientInfo.userId,
    position,
    color,
  }, ws);
}

async function handleReconnect(ws, data) {
  const clientInfo = clients.get(ws);
  if (!clientInfo.authenticated) {
    send(ws, { type: 'error', message: 'Not authenticated', code: 'AUTH_REQUIRED' });
    return;
  }

  const { docId, baseVersion, bufferedOps } = data;
  const engine = await getOrCreateEngine(docId);

  // Add to room
  if (!rooms.has(docId)) rooms.set(docId, new Set());
  rooms.get(docId).add(ws);
  clientInfo.docs.add(docId);

  try {
    // Fetch ops since the client's last known version
    let missedOps = await getCachedOps(docId, baseVersion);

    // Fallback to PostgreSQL if Redis cache doesn't have enough
    if (missedOps.length === 0 && baseVersion < engine.getVersion()) {
      const dbOps = await getOpsSinceDb(docId, baseVersion);
      missedOps = dbOps;
    }

    // Apply each of the client's buffered ops through the engine
    const appliedOps = [];
    if (Array.isArray(bufferedOps)) {
      for (const bufferedOp of bufferedOps) {
        const stampedOp = { ...bufferedOp, clientId: clientInfo.userId };
        const result = await engine.receiveOp(stampedOp, baseVersion);
        if (result.transformedOp) {
          appliedOps.push({
            op:      result.transformedOp,
            version: result.newVersion,
          });

          // Broadcast to other clients
          broadcast(docId, {
            type:     'sync',
            docId,
            op:       result.transformedOp,
            version:  result.newVersion,
            clientId: clientInfo.userId,
          }, ws);
        }
      }
    }

    // Send the client all ops they missed + confirmation of their buffered ops
    send(ws, {
      type:    'catch_up',
      docId,
      ops:     missedOps,
      version: engine.getVersion(),
      doc:     engine.getDocument(),
    });

    console.log(`[WS] Client ${clientInfo.userId} reconnected to doc=${docId}, missed ${missedOps.length} ops, applied ${appliedOps.length} buffered ops`);
  } catch (err) {
    console.error(`[WS] Reconnect error doc=${docId}:`, err.message);
    send(ws, { type: 'error', message: err.message, code: 'RECONNECT_ERROR' });
  }
}

// ─────────────────────────────────────────────────────────
// SERVER SETUP
// ─────────────────────────────────────────────────────────

/**
 * Create and start the WebSocket server.
 * @param {import('http').Server} httpServer - HTTP server to attach to
 * @returns {WebSocketServer}
 */
function createWSServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer });

  // ── Heartbeat ──────────────────────────────────────────
  const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        console.log('[WS] Terminating stale connection');
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL);

  wss.on('close', () => clearInterval(heartbeatInterval));

  // ── Connection handler ─────────────────────────────────
  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // Track client state
    clients.set(ws, {
      userId:        null,
      authenticated: false,
      docs:          new Set(),
    });

    // Check for token in query params (optional auto-auth)
    const url = new URL(req.url, `http://${req.headers.host}`);
    const queryToken = url.searchParams.get('token');
    if (queryToken) {
      handleAuth(ws, { token: queryToken });
    }

    ws.on('message', async (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch (e) {
        send(ws, { type: 'error', message: 'Invalid JSON', code: 'PARSE_ERROR' });
        return;
      }

      switch (data.type) {
        case 'auth':      await handleAuth(ws, data);      break;
        case 'join':      await handleJoin(ws, data);      break;
        case 'op':        await handleOp(ws, data);        break;
        case 'cursor':    handleCursor(ws, data);          break; // sync, no await needed
        case 'reconnect': await handleReconnect(ws, data); break;
        default:
          send(ws, { type: 'error', message: `Unknown message type: ${data.type}`, code: 'UNKNOWN_TYPE' });
      }
    });

    ws.on('close', () => {
      const clientInfo = clients.get(ws);
      if (clientInfo) {
        for (const docId of clientInfo.docs) {
          const room = rooms.get(docId);
          if (room) {
            room.delete(ws);
            if (room.size === 0) rooms.delete(docId);
          }
          // Remove cursor and notify peers this user left
          const docCursors = cursors.get(docId);
          if (docCursors && clientInfo.userId) {
            docCursors.delete(clientInfo.userId);
            if (docCursors.size === 0) cursors.delete(docId);
            broadcast(docId, {
              type:   'cursor_leave',
              docId,
              userId: clientInfo.userId,
            });
          }
        }
        console.log(`[WS] Client ${clientInfo.userId || 'unknown'} disconnected`);
      }
      clients.delete(ws);
    });

    ws.on('error', (err) => {
      console.error('[WS] Socket error:', err.message);
    });
  });

  console.log('[WS] WebSocket server attached to HTTP server');
  return wss;
}

/**
 * Get current server state (for debugging / monitoring).
 */
function getServerState() {
  const state = {};
  for (const [docId, engine] of engines) {
    state[docId] = {
      version:  engine.getVersion(),
      docLength: engine.getDocument().length,
      clients: rooms.has(docId) ? rooms.get(docId).size : 0,
    };
  }
  return state;
}

module.exports = { createWSServer, getServerState, engines, rooms };
