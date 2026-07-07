import { useState, useEffect, useCallback, useRef } from 'react';

export function useSyncEngine({ userId, docId, editorRef }) {
  const [status, setStatus] = useState('disconnected'); // disconnected, connecting, connected
  const [version, setVersion] = useState(0);
  const [opsSent, setOpsSent] = useState(0);
  const [opsRecv, setOpsRecv] = useState(0);
  const [logs, setLogs] = useState([]);

  const wsRef = useRef(null);
  const lastSentContent = useRef('');
  const versionRef = useRef(0);
  const connectionIntent = useRef(false);

  const addLog = useCallback((type, from, detail) => {
    setLogs(prev => {
      const newLogs = [{ id: Date.now() + Math.random(), type, from, detail }, ...prev];
      return newLogs.slice(0, 50); // Keep last 50
    });
  }, []);

  const connect = useCallback(async () => {
    if (wsRef.current) return;
    setStatus('connecting');
    connectionIntent.current = true;

    try {
      const res = await fetch(`/api/token?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      
      if (!connectionIntent.current) return;

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      // Use the proxy port if in dev, else relative
      const wsUrl = `${wsProtocol}//${window.location.host}/socket?token=${encodeURIComponent(data.token)}`;
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join', docId }));
      };

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
            break;

          case 'ack':
            setVersion(msg.version);
            versionRef.current = msg.version;
            break;

          case 'sync': {
            setOpsRecv(r => r + 1);
            setVersion(msg.version);
            versionRef.current = msg.version;
            
            // Apply remote op safely preserving cursor
            if (editorRef.current) {
              const el = editorRef.current;
              const cursor = el.selectionStart;
              const text = el.value;
              const op = msg.op;
              
              if (op.type === 'insert') {
                const pos = Math.min(op.position, text.length);
                el.value = text.slice(0, pos) + op.text + text.slice(pos);
                if (cursor >= pos) {
                  el.setSelectionRange(cursor + op.text.length, cursor + op.text.length);
                } else {
                  el.setSelectionRange(cursor, cursor);
                }
              } else if (op.type === 'delete') {
                const pos = Math.min(op.position, text.length);
                const end = Math.min(pos + op.length, text.length);
                el.value = text.slice(0, pos) + text.slice(end);
                
                if (cursor > pos && cursor <= end) {
                  el.setSelectionRange(pos, pos);
                } else if (cursor > end) {
                  el.setSelectionRange(cursor - op.length, cursor - op.length);
                } else {
                  el.setSelectionRange(cursor, cursor);
                }
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
            
          case 'rate_limited':
            addLog('LIMIT', 'server', msg.message);
            break;
            
          case 'error':
            addLog('ERROR', 'server', msg.message);
            break;
            
          default:
            break;
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (connectionIntent.current) {
          setStatus('disconnected');
        }
      };

      ws.onerror = (err) => {
        console.error('WS Error', err);
        setStatus('disconnected');
      };
      
    } catch (err) {
      console.error('Connect error', err);
      setStatus('disconnected');
      wsRef.current = null;
    }
  }, [userId, docId, editorRef, addLog]);

  const disconnect = useCallback(() => {
    connectionIntent.current = false;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus('disconnected');
  }, []);

  // Compute diffs and send ops
  const handleEditorInput = useCallback(() => {
    if (!wsRef.current || status !== 'connected' || !editorRef.current) return;

    const el = editorRef.current;
    const oldText = lastSentContent.current;
    const newText = el.value;
    
    if (oldText === newText) return;

    let start = 0;
    while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) {
      start++;
    }

    let oldEnd = oldText.length;
    let newEnd = newText.length;
    while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }

    const deletedLen = oldEnd - start;
    const insertedText = newText.slice(start, newEnd);
    
    const currentVer = versionRef.current;

    if (deletedLen > 0) {
      const delOp = { type: 'delete', position: start, length: deletedLen, clientId: userId, version: currentVer };
      wsRef.current.send(JSON.stringify({ type: 'op', docId, op: delOp, version: currentVer }));
      setOpsSent(s => s + 1);
      addLog('DELETE', 'me', `pos=${start} len=${deletedLen}`);
    }

    if (insertedText.length > 0) {
      const insOp = { type: 'insert', position: start, text: insertedText, clientId: userId, version: currentVer };
      wsRef.current.send(JSON.stringify({ type: 'op', docId, op: insOp, version: currentVer }));
      setOpsSent(s => s + 1);
      addLog('INSERT', 'me', `pos=${start} "${insertedText}"`);
    }

    lastSentContent.current = newText;
  }, [userId, docId, status, addLog, editorRef]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    status,
    version,
    opsSent,
    opsRecv,
    logs,
    connect,
    disconnect,
    handleEditorInput
  };
}

function formatOp(op) {
  if (op.type === 'insert') return `pos=${op.position} "${op.text}"`;
  if (op.type === 'delete') return `pos=${op.position} len=${op.length}`;
  return JSON.stringify(op);
}
