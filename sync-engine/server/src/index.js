/**
 * Application Entry Point
 * ==========================================================
 * Bootstraps the entire sync engine:
 *   1. Load environment variables
 *   2. Run database migrations
 *   3. Start HTTP server (serves static client files)
 *   4. Attach WebSocket server
 *   5. Graceful shutdown handling
 * ==========================================================
 */

'use strict';

require('dotenv').config();

const http = require('http');
const fs   = require('fs');
const path = require('path');

const { runMigrations }   = require('./db/migrations');
const { pool }            = require('./db/pool');
const { createWSServer, getServerState } = require('./ws/server');
const { getRedisClient, closeRedis }     = require('./redis/client');
const { generateToken }   = require('./auth/jwt');

const PORT = parseInt(process.env.PORT || '3000', 10);

// ─────────────────────────────────────────────────────────
// HTTP SERVER (serves client + REST endpoints)
// ─────────────────────────────────────────────────────────

const MIME_TYPES = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

const server = http.createServer((req, res) => {
  // ── REST API endpoints ───────────────────────────────
  if (req.method === 'GET' && req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  if (req.method === 'GET' && req.url === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getServerState()));
    return;
  }

  // Generate a demo token for quick testing
  if (req.method === 'GET' && req.url?.startsWith('/api/token')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const userId = url.searchParams.get('userId') || `user-${Date.now()}`;
    const token = generateToken(userId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ token, userId }));
    return;
  }

  // ── Static file serving (client) ─────────────────────
  const clientDir = path.resolve(__dirname, '../../client');
  let filePath = path.join(clientDir, req.url === '/' ? 'index.html' : req.url);

  // Security: prevent directory traversal
  if (!filePath.startsWith(clientDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// ─────────────────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────────────────

async function start() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Real-Time Collaborative Sync Engine');
  console.log('═══════════════════════════════════════════════');

  // 1. Connect to Redis
  try {
    getRedisClient();
    console.log('[Boot] Redis client initialized');
  } catch (err) {
    console.error('[Boot] Redis connection failed:', err.message);
    console.warn('[Boot] Continuing without Redis (ops won\'t be cached)');
  }

  // 2. Run database migrations
  try {
    await runMigrations();
    console.log('[Boot] Database migrations complete');
  } catch (err) {
    console.error('[Boot] Database migration failed:', err.message);
    console.warn('[Boot] Continuing without PostgreSQL (ops won\'t be persisted)');
  }

  // 3. Attach WebSocket server
  createWSServer(server);

  // 4. Start HTTP server
  server.listen(PORT, () => {
    console.log(`[Boot] HTTP server listening on http://localhost:${PORT}`);
    console.log(`[Boot] WebSocket server listening on ws://localhost:${PORT}`);
    console.log(`[Boot] Demo client: http://localhost:${PORT}/`);
    console.log(`[Boot] Get token:   http://localhost:${PORT}/api/token?userId=alice`);
    console.log('═══════════════════════════════════════════════');
  });
}

// ─────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────

async function shutdown(signal) {
  console.log(`\n[Shutdown] Received ${signal}, shutting down gracefully...`);

  server.close(() => {
    console.log('[Shutdown] HTTP server closed');
  });

  try {
    await closeRedis();
    console.log('[Shutdown] Redis disconnected');
  } catch (e) { /* ignore */ }

  try {
    await pool.end();
    console.log('[Shutdown] PostgreSQL pool closed');
  } catch (e) { /* ignore */ }

  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Start the server
start().catch(err => {
  console.error('[Boot] Fatal error:', err);
  process.exit(1);
});
