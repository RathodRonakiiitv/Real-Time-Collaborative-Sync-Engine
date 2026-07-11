import React, { useState, useRef, useEffect } from 'react';
import { Header } from './components/Header';
import { StatusBar } from './components/StatusBar';
import { Editor } from './components/Editor';
import { LogPanel } from './components/LogPanel';
import { VersionHistory } from './components/VersionHistory';
import { AwarenessBar } from './components/AwarenessBar';
import { useSyncEngine } from './hooks/useSyncEngine';

function App() {
  const [userId, setUserId] = useState(() => 'user-' + Math.random().toString(36).slice(2, 6));
  const [docId, setDocId] = useState('demo-doc');
  const [rightPanel, setRightPanel] = useState('logs'); // 'logs' | 'history'
  
  const editorRef = useRef(null);

  const {
    status,
    version,
    opsSent,
    opsRecv,
    logs,
    connect,
    disconnect,
    handleEditorInput,
    peerCursors,
    sendCursor,
    activeUsers,
    typingUsers,
    sendTyping
  } = useSyncEngine({
    userId,
    docId,
    editorRef
  });

  // Debounce editor input handling
  const inputTimeout = useRef(null);
  const onTextChange = () => {
    sendTyping();
    if (inputTimeout.current) clearTimeout(inputTimeout.current);
    inputTimeout.current = setTimeout(() => {
      handleEditorInput();
    }, 50);
  };

  // Add global styles for connection state
  useEffect(() => {
    if (status === 'connected') {
      document.documentElement.style.setProperty('--border', 'var(--accent-glow)');
    } else {
      document.documentElement.style.setProperty('--border', '#2a2f42');
    }
  }, [status]);

  return (
    <div className="app-container">
      <Header 
        userId={userId} 
        setUserId={setUserId}
        docId={docId}
        setDocId={setDocId}
        status={status}
        connect={connect}
        disconnect={disconnect}
        rightPanel={rightPanel}
        setRightPanel={setRightPanel}
      />
      <StatusBar 
        status={status}
        version={version}
        opsSent={opsSent}
        opsRecv={opsRecv}
      />
      
      <AwarenessBar 
        activeUsers={activeUsers}
        typingUsers={typingUsers}
        currentUserId={userId}
      />

      <main className="main-content">
        <Editor 
          ref={editorRef} 
          status={status} 
          onChange={onTextChange} 
          peerCursors={peerCursors}
          onCursorMove={sendCursor}
        />
        {rightPanel === 'history' ? (
          <VersionHistory 
            docId={docId}
            currentVersion={version}
            status={status}
          />
        ) : (
          <LogPanel logs={logs} />
        )}
      </main>
    </div>
  );
}

export default App;
