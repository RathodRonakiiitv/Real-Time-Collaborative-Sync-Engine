import React from 'react';

export const Editor = React.forwardRef(({ status, onChange }, ref) => {
  const isConnected = status === 'connected';

  return (
    <div style={styles.container} className="glass-panel">
      <textarea
        ref={ref}
        style={{
          ...styles.textarea,
          borderColor: isConnected ? 'transparent' : 'var(--border)',
          opacity: isConnected ? 1 : 0.7
        }}
        placeholder={isConnected ? "Start collaborating..." : "Connect to start editing..."}
        disabled={!isConnected}
        onChange={onChange}
        spellCheck="false"
      />
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
    zIndex: 2,
    transition: 'all 0.3s ease',
  },
  glow: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    boxShadow: 'inset 0 0 0 1px var(--accent-glow)',
    pointerEvents: 'none',
    zIndex: 1,
    borderRadius: '12px',
  }
};
