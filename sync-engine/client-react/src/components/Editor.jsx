import React, { useState, useEffect } from 'react';

export const Editor = React.forwardRef(({ status, onChange, peerCursors = {}, onCursorMove }, ref) => {
  const isConnected = status === 'connected';
  const [mirrorHtml, setMirrorHtml] = useState([]);

  // We rely on peerCursors changes to re-render the mirror. 
  // We don't track textarea value in React state since it's uncontrolled.
  useEffect(() => {
    const text = ref?.current?.value || '';
    const sortedCursors = Object.entries(peerCursors).sort((a, b) => a[1].position - b[1].position);
    
    const elements = [];
    let lastIdx = 0;
    
    sortedCursors.forEach(([uid, cur]) => {
      const pos = Math.min(cur.position, text.length);
      elements.push(text.slice(lastIdx, pos));
      
      elements.push(
        <span key={uid} className="cursor-caret" style={{ background: cur.color }}>
          <span className="cursor-label" style={{ background: cur.color }}>{uid}</span>
        </span>
      );
      lastIdx = pos;
    });
    
    elements.push(text.slice(lastIdx));
    setMirrorHtml(elements);
  }, [peerCursors, ref]);

  const handleCursorMove = (e) => {
    if (onCursorMove) onCursorMove(e.target.selectionStart);
  };

  return (
    <div style={styles.container} className="glass-panel">
      <div className="editor-wrapper" style={styles.wrapper}>
        <textarea
          ref={ref}
          id="editor"
          style={{
            ...styles.textarea,
            borderColor: isConnected ? 'transparent' : 'var(--border)',
            opacity: isConnected ? 1 : 0.7
          }}
          placeholder={isConnected ? "Start collaborating..." : "Connect to start editing..."}
          disabled={!isConnected}
          onChange={onChange}
          onClick={handleCursorMove}
          onKeyUp={handleCursorMove}
          spellCheck="false"
        />
        <div id="editorMirror" aria-hidden="true" style={styles.mirror}>
          {mirrorHtml}
        </div>
      </div>
      {isConnected && <div style={styles.glow} />}
    </div>
  );
});

Editor.displayName = 'Editor';

const styles = {
  container: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    overflow: 'hidden',
  },
  wrapper: {
    flex: 1,
    position: 'relative',
    display: 'flex'
  },
  textarea: {
    flex: 1,
    background: 'transparent',
    border: '1px solid transparent',
    padding: '24px',
    fontFamily: 'var(--font-mono)',
    fontSize: '15px',
    lineHeight: '1.7',
    color: 'var(--text)',
    resize: 'none',
    outline: 'none',
    zIndex: 1,
    transition: 'all 0.3s ease',
  },
  mirror: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    padding: '24px',
    fontFamily: 'var(--font-mono)',
    fontSize: '15px',
    lineHeight: '1.7',
    color: 'transparent',
    pointerEvents: 'none',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflow: 'hidden',
    borderRadius: '12px',
    zIndex: 2,
  },
  glow: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    boxShadow: 'inset 0 0 0 1px var(--accent-glow)',
    pointerEvents: 'none',
    zIndex: 3,
    borderRadius: '12px',
  }
};
