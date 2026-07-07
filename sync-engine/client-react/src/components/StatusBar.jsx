import React from 'react';

export function StatusBar({ status, version, opsSent, opsRecv }) {
  let statusText = 'Disconnected';
  let dotClass = 'dot';
  if (status === 'connected') {
    statusText = 'Connected';
    dotClass = 'dot connected';
  } else if (status === 'connecting') {
    statusText = 'Connecting...';
    dotClass = 'dot connecting';
  }

  return (
    <div style={styles.statusBar} className="glass-panel">
      <div style={styles.indicator}>
        <div className={dotClass} style={styles.dot}></div>
        <span style={styles.statusText}>{statusText}</span>
      </div>
      <div style={styles.indicator}>
        <span>Version:</span>
        <span style={styles.badge}>{version}</span>
      </div>
      <div style={styles.indicator}>
        <span>Ops sent:</span>
        <span style={styles.badge}>{opsSent}</span>
      </div>
      <div style={styles.indicator}>
        <span>Ops recv:</span>
        <span style={styles.badge}>{opsRecv}</span>
      </div>
    </div>
  );
}

const styles = {
  statusBar: {
    padding: '8px 24px',
    display: 'flex',
    alignItems: 'center',
    gap: '24px',
    fontSize: '12px',
    color: 'var(--text-dim)',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderTop: '1px solid var(--border)',
    marginBottom: '24px',
  },
  indicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: 'var(--red)',
    transition: 'all 0.3s',
  },
  statusText: {
    fontWeight: '500',
  },
  badge: {
    background: 'var(--surface-2)',
    padding: '2px 8px',
    borderRadius: '4px',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--text)',
  }
};
