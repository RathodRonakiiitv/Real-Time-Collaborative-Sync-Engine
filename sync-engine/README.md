# Real-Time Collaborative Sync Engine

A **Google Docs-style** collaborative editing engine built from scratch. No OT libraries — the conflict resolution algorithm is hand-coded.

## Architecture

```
┌──────────────┐     WebSocket      ┌──────────────────────────────┐
│  Client A    │◄──────────────────►│                              │
│  (Browser)   │                    │     WebSocket Server         │
└──────────────┘                    │                              │
                                    │  ┌────────────────────────┐  │
┌──────────────┐     WebSocket      │  │   DocumentEngine       │  │
│  Client B    │◄──────────────────►│  │   (per document)       │  │
│  (Browser)   │                    │  │                        │  │
└──────────────┘                    │  │  • receiveOp()         │  │
                                    │  │  • transform()         │  │
┌──────────────┐     WebSocket      │  │  • applyOp()           │  │
│  Client C    │◄──────────────────►│  │  • broadcast()         │  │
│  (Browser)   │                    │  └────────────────────────┘  │
└──────────────┘                    │                              │
                                    │  ┌──────┐    ┌───────────┐  │
                                    │  │ Redis │    │ PostgreSQL│  │
                                    │  │ Cache │    │ Snapshots │  │
                                    │  └──────┘    └───────────┘  │
                                    └──────────────────────────────┘
```

## How OT (Operational Transformation) Works

When two clients edit the same document simultaneously:

```
Client A types "Hello"     Client B types "World" (at same time)
       ↓                            ↓
   [insert(0,"Hello")]        [insert(0,"World")]
       ↓                            ↓
          → Server receives both →
          → Transforms B relative to A →
          → Broadcasts merged result to all →
       ↓                            ↓
   Both clients show: "HelloWorld"  ✅
```

The `transform(op1, op2)` function handles 4 conflict cases:
- **insert vs insert** — shift positions based on insertion point
- **insert vs delete** — adjust delete range around insertion
- **delete vs insert** — adjust insert position around deletion
- **delete vs delete** — handle overlapping deletion ranges

## Tech Stack

| Layer | Technology |
|---|---|
| Backend Runtime | Node.js |
| Real-time Transport | WebSockets (`ws`) |
| Conflict Resolution | Custom OT (hand-coded) |
| Database | PostgreSQL (snapshots) |
| Cache | Redis (op log cache) |
| Rate Limiting | Token Bucket via Redis |
| Auth | JWT |
| Testing | Jest |
| Frontend | Vanilla HTML/JS |
| Containerization | Docker Compose |

## Quick Start

### Option 1: Docker Compose (Recommended)

```bash
# Start everything (Redis + PostgreSQL + Server)
docker compose up --build

# Open two browser tabs to:
# http://localhost:3000
```

### Option 2: Local Development

```bash
# Prerequisites: Redis and PostgreSQL running locally

# Copy environment config
cp server/.env.example server/.env

# Install dependencies
cd server && npm install

# Run the server
node src/index.js

# Open http://localhost:3000
```

## API

### REST Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/state` | Server state (documents, versions, clients) |
| GET | `/api/token?userId=alice` | Generate a demo JWT token |

### WebSocket Protocol

**Client → Server:**

```json
{ "type": "auth",      "token": "jwt..." }
{ "type": "join",      "docId": "doc-1" }
{ "type": "op",        "docId": "doc-1", "op": {...}, "version": 5 }
{ "type": "reconnect", "docId": "doc-1", "baseVersion": 3, "bufferedOps": [...] }
```

**Server → Client:**

```json
{ "type": "auth_ok",      "userId": "alice" }
{ "type": "joined",       "docId": "doc-1", "doc": "...", "version": 5 }
{ "type": "sync",         "docId": "doc-1", "op": {...}, "version": 6, "clientId": "bob" }
{ "type": "ack",          "docId": "doc-1", "version": 6 }
{ "type": "catch_up",     "docId": "doc-1", "ops": [...], "version": 10, "doc": "..." }
{ "type": "rate_limited", "message": "...", "retryAfterMs": 1000 }
```

## Project Structure

```
sync-engine/
├── docker-compose.yml          # Redis, PostgreSQL, Server
├── server/
│   ├── src/
│   │   ├── ot/
│   │   │   ├── operations.js   # Op schema + transform() — THE CORE
│   │   │   └── engine.js       # DocumentEngine + persistence hooks
│   │   ├── ws/
│   │   │   └── server.js       # WebSocket server + room management
│   │   ├── redis/
│   │   │   ├── client.js       # Redis client + op cache
│   │   │   └── ratelimit.js    # Token Bucket rate limiter
│   │   ├── db/
│   │   │   ├── pool.js         # PostgreSQL connection pool
│   │   │   ├── migrations.js   # Auto-create tables
│   │   │   ├── operations.js   # Op log persistence
│   │   │   └── snapshots.js    # Snapshot read/write
│   │   ├── auth/
│   │   │   └── jwt.js          # JWT generation + validation
│   │   └── index.js            # Entry point
│   └── tests/
│       ├── ot.test.js          # Unit tests for transform()
│       ├── convergence.test.js # Formal convergence proofs
│       └── integration.test.js # End-to-end WebSocket tests
├── client/
│   └── index.html              # Demo collaborative editor
└── README.md
```

## Testing

```bash
cd server

# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Test Coverage

- **OT Unit Tests** — All 4 transform cases, edge cases, unicode
- **Convergence Proofs** — 2-client, 3-client (all permutations), randomized fuzz
- **Integration Tests** — Auth, room join, concurrent sync, multi-client convergence

## System Design Concepts Covered

| Concept | Implementation |
|---|---|
| ✅ Real-time communication | WebSockets with room management |
| ✅ Conflict resolution | OT `transform()` from scratch |
| ✅ Eventual consistency | Convergence proofs (formal tests) |
| ✅ Caching | Redis op log cache |
| ✅ Rate limiting | Token Bucket via Redis |
| ✅ Event sourcing | Immutable op log + snapshot pattern |
| ✅ Persistence & recovery | PostgreSQL + replay on startup |
| ✅ Offline sync | Buffer + transform on reconnect |
| ✅ Auth & access control | JWT + room tokens |
| ✅ Formal correctness | Convergence proof tests |

## Key Design Decisions

1. **OT over CRDT** — Simpler for plain text, used by Google Docs
2. **Server-authoritative** — Single source of truth prevents divergence
3. **Event sourcing** — Every op is immutable, enabling full history replay
4. **Snapshot + replay** — Fast recovery without replaying entire history
5. **Redis cache + PG fallback** — Fast reconnect with durable persistence
