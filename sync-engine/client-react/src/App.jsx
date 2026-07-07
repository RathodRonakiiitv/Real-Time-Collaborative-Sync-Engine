import React, { useState, useRef, useEffect } from 'react';
import { Header } from './components/Header';
import { StatusBar } from './components/StatusBar';
import { Editor } from './components/Editor';
import { LogPanel } from './components/LogPanel';
import { useSyncEngine } from './hooks/useSyncEngine';

function App() {
  const [userId, setUserId] = useState(() => 'user-' + Math.random().toString(36).slice(2, 6));
  const [docId, setDocId] = useState('demo-doc');
  
  const editorRef = useRef(null);

  const {
    status,
    version,
    opsSent,
    opsRecv,
    logs,
    connect,
    disconnect,
    handleEditorInput
  } = useSyncEngine({
    userId,
    docId,
    editorRef
  });

  // Debounce editor input handling
  const inputTimeout = useRef(null);
  const onTextChange = () => {
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
      />
      <StatusBar 
        status={status}
        version={version}
        opsSent={opsSent}
        opsRecv={opsRecv}
      />
      
      <main className="main-content">
        <Editor 
          ref={editorRef} 
          status={status} 
          onChange={onTextChange} 
        />
        <LogPanel logs={logs} />
      </main>
    </div>
  );
}

export default App;
