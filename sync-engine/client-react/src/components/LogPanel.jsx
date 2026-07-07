import React from 'react';
import { Activity } from 'lucide-react';

export function LogPanel({ logs }) {
  return (
    <div style={styles.panel} className="glass-panel">
      <div style={styles.header}>
        <Activity size={14} />
        Operation Log
      </div>
      <div style={styles.logContainer}>
        {logs.map((log) => (
          <div key={log.id} style={styles.entry}>
            <span style={{ ...styles.type, color: getTypeColor(log.type) }}>
              {log.type}
            </span>
            <span style={styles.from}>{log.from}</span>
            <span style={styles.detail}>{log.detail}</span>
          </div>
        ))}
        {logs.length === 0 && (
          <div style={styles.empty}>No operations yet</div>
        )}
      </div>
    </div>
  );
}

function getTypeColor(type) {
  switch (type) {
    case 'INSERT': return 'var(--green)';
    case 'DELETE': return 'var(--red)';
    case 'SYNC':   return 'var(--accent)';
    case 'AUTH':   return '#a78bfa';
    case 'LIMIT':  return 'var(--yellow)';
    case 'ERROR':  return 'var(--red)';
    default:       return 'var(--text-dim)';
  }
}

const styles = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
  },
  header: {
    padding: '12px 16px',
    fontSize: '11px',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    color: 'var(--text-dim)',
    borderBottom: '1px solid var(--border)',
    background: 'var(--surface-2)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    borderTopLeftRadius: '12px',
    borderTopRightRadius: '12px',
  },
  logContainer: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 0',
  },
  entry: {
    padding: '6px 16px',
    fontSize: '12px',
    fontFamily: 'var(--font-mono)',
    borderBottom: '1px solid var(--border)',
    display: 'grid',
    gridTemplateColumns: '60px 60px 1fr',
    gap: '12px',
    alignItems: 'center',
  },
  type: {
    fontWeight: '600',
    fontSize: '11px',
  },
  from: {
    color: 'var(--text-dim)',
  },
  detail: {
    color: 'var(--text)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  empty: {
    padding: '24px',
    textAlign: 'center',
    color: 'var(--border)',
    fontSize: '13px',
    fontStyle: 'italic',
  }
};
