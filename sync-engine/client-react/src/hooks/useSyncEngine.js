import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Production vs Dev server URL ────────────────────────────────────────────
// In dev, Vite proxies /api and /socket to localhost:3001 (see vite.config.js).
// In production (Vercel → Railway), set VITE_SERVER_URL to the Railway domain.
// Example: VITE_SERVER_URL=https://sync-engine-server.up.railway.app
const SERVER_BASE = import.meta.env.VITE_SERVER_URL || '';

// Deterministic color from userId — matches server palette
const CURSOR_COLORS = [
  '#f87171','#fb923c','#facc15','#34d399',
  '#38bdf8','#a78bfa','#f472b6','#2dd4bf',
];
export function getUserColor(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}

export function useSyncEngine({ userId, docId, editorRef }) {
  const [status, setStatus]           = useState('disconnected');
  const [version, setVersion]         = useState(0);
  const [opsSent, setOpsSent]         = useState(0);
  const [opsRecv, setOpsRecv]         = useState(0);
  const [logs, setLogs]               = useState([]);
  const [peerCursors, setPeerCursors] = useState({}); // userId → { position, color }
  const [activeUsers, setActiveUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState(new Set());

  const wsRef            = useRef(null);
  const lastSentContent  = useRef('');
  const versionRef       = useRef(0);
  const connectionIntent = useRef(false);
  const typingDebounce   = useRef(null);

  const addLog = useCallback((type, from, detail) => {
    setLogs(prev => [{ id: Date.now() + Math.random(), type, from, detail }, ...prev].slice(0, 50));
  }, []);

  // Broadcast this client's cursor position to peers
  const sendCursor = useCallback((position) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'cursor', docId, position }));
  }, [docId]);

  const connect = useCallback(async () => {
    if (wsRef.current) return;
    setStatus('connecting');
    connectionIntent.current = true;

    try {
      const res  = await fetch(`${SERVER_BASE}/api/token?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (!connectionIntent.current) return;

      // If SERVER_BASE is set, derive the wss:// URL from it.
      // Otherwise fall back to the current page's host (dev mode with Vite proxy).
      let wsUrl;
      if (SERVER_BASE) {
        const wsBase = SERVER_BASE.replace(/^https/, 'wss').replace(/^http/, 'ws');
        wsUrl = `${wsBase}/socket?token=${encodeURIComponent(data.token)}`;
      } else {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${wsProtocol}//${window.location.host}/socket?token=${encodeURIComponent(data.token)}`;
      }
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => ws.send(JSON.stringify({ type: 'join', docId }));

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        switch (msg.type) {

          case 'auth_ok':
            addLog('AUTH', msg.userId, 'Authenticated');
            break;

          case 'joined':
            setStatus('connected');
            setVersion(msg.version);
            versionRef.current = msg.version;
            if (editorRef.current) {
              editorRef.current.value = msg.doc;
              lastSentContent.current = msg.doc;
            }
            addLog('JOIN', 'server', `Joined (v${msg.version})`);
            // Seed any existing peer cursors already in the room
            if (msg.cursors) {
              const initial = {};
              for (const [uid, cur] of Object.entries(msg.cursors)) {
                initial[uid] = { position: cur.position, color: cur.color };
              }
              setPeerCursors(initial);
            }
            if (msg.presence) {
              setActiveUsers(msg.presence);
            }
            break;

          case 'ack':
            setVersion(msg.version);
            versionRef.current = msg.version;
            break;

          case 'sync': {
            setOpsRecv(r => r + 1);
            setVersion(msg.version);
            versionRef.current = msg.version;
            if (editorRef.current) {
              const el     = editorRef.current;
              const cursor = el.selectionStart;
              const text   = el.value;
              const op     = msg.op;
              if (op.type === 'insert') {
                const pos    = Math.min(op.position, text.length);
                el.value     = text.slice(0, pos) + op.text + text.slice(pos);
                const newPos = cursor >= pos ? cursor + op.text.length : cursor;
                el.setSelectionRange(newPos, newPos);
              } else if (op.type === 'delete') {
                const pos    = Math.min(op.position, text.length);
                const end    = Math.min(pos + op.length, text.length);
                el.value     = text.slice(0, pos) + text.slice(end);
                const newPos = cursor > pos && cursor <= end ? pos
                             : cursor > end ? cursor - op.length : cursor;
                el.setSelectionRange(newPos, newPos);
              }
              lastSentContent.current = el.value;
            }
            addLog(msg.op.type.toUpperCase(), msg.clientId, formatOp(msg.op));
            break;
          }

          case 'catch_up':
            setVersion(msg.version);
            versionRef.current = msg.version;
            if (editorRef.current) {
              editorRef.current.value = msg.doc;
              lastSentContent.current = msg.doc;
            }
            addLog('SYNC', 'server', `Caught up to v${msg.version}`);
            break;

          // ── CURSOR PRESENCE (ephemeral) ────────────────
          case 'cursor_move':
            setPeerCursors(prev => ({
              ...prev,
              [msg.userId]: { position: msg.position, color: msg.color },
            }));
            break;

          case 'cursor_leave':
            setPeerCursors(prev => {
              const next = { ...prev };
              delete next[msg.userId];
              return next;
            });
            addLog('LEAVE', msg.userId, 'left the document');
            break;

          // ── PRESENCE & TYPING ──────────────────────────
          case 'presence':
            setActiveUsers(msg.users || []);
            break;

          case 'typing':
            setTypingUsers(prev => {
              const next = new Set(prev);
              if (msg.isTyping) next.add(msg.userId);
              else next.delete(msg.userId);
              return next;
            });
            break;

          case 'rate_limited':
            addLog('LIMIT', 'server', msg.message);
            break;

          case 'error':
            addLog('ERROR', 'server', msg.message);
            break;

          default: break;
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (connectionIntent.current) setStatus('disconnected');
        setPeerCursors({});
        setActiveUsers([]);
        setTypingUsers(new Set());
      };

      ws.onerror = () => setStatus('disconnected');

    } catch (err) {
      console.error('Connect error', err);
      setStatus('disconnected');
      wsRef.current = null;
    }
  }, [userId, docId, editorRef, addLog]);

  const disconnect = useCallback(() => {
    connectionIntent.current = false;
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setStatus('disconnected');
    setPeerCursors({});
    setActiveUsers([]);
    setTypingUsers(new Set());
    if (typingDebounce.current) clearTimeout(typingDebounce.current);
  }, []);

  const sendTyping = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    
    // Clear existing timer if any
    if (typingDebounce.current) {
      clearTimeout(typingDebounce.current);
    } else {
      // First keystroke -> send typing_start
      wsRef.current.send(JSON.stringify({ type: 'typing_start', docId }));
    }

    // Auto-stop locally after 3s to match server timeout
    typingDebounce.current = setTimeout(() => {
      typingDebounce.current = null;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'typing_stop', docId }));
      }
    }, 3000);
  }, [docId]);

  const handleEditorInput = useCallback(() => {
    if (!wsRef.current || status !== 'connected' || !editorRef.current) return;

    const el      = editorRef.current;
    const oldText = lastSentContent.current;
    const newText = el.value;
    if (oldText === newText) return;

    let start = 0;
    while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) start++;
    let oldEnd = oldText.length, newEnd = newText.length;
    while (oldEnd > start && newEnd > start && oldText[oldEnd-1] === newText[newEnd-1]) { oldEnd--; newEnd--; }

    const deletedLen   = oldEnd - start;
    const insertedText = newText.slice(start, newEnd);
    const ver          = versionRef.current;

    if (deletedLen > 0) {
      const op = { type: 'delete', position: start, length: deletedLen, clientId: userId, version: ver };
      wsRef.current.send(JSON.stringify({ type: 'op', docId, op, version: ver }));
      setOpsSent(s => s + 1);
      addLog('DELETE', 'me', `pos=${start} len=${deletedLen}`);
    }
    if (insertedText.length > 0) {
      const op = { type: 'insert', position: start, text: insertedText, clientId: userId, version: ver };
      wsRef.current.send(JSON.stringify({ type: 'op', docId, op, version: ver }));
      setOpsSent(s => s + 1);
      addLog('INSERT', 'me', `pos=${start} "${insertedText}"`);
    }

    lastSentContent.current = newText;
    sendCursor(el.selectionStart); // send cursor after every edit
  }, [userId, docId, status, addLog, editorRef, sendCursor]);

  useEffect(() => () => disconnect(), [disconnect]);

  return {
    status, version, opsSent, opsRecv, logs,
    peerCursors, activeUsers, typingUsers,
    sendCursor, sendTyping,
    connect, disconnect, handleEditorInput,
  };
}

function formatOp(op) {
  if (op.type === 'insert') return `pos=${op.position} "${op.text}"`;
  if (op.type === 'delete') return `pos=${op.position} len=${op.length}`;
  return JSON.stringify(op);
}
