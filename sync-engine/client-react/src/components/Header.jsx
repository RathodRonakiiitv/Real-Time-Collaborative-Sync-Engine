import React from 'react';
import { Zap, History, Activity } from 'lucide-react';

export function Header({ 
  userId, setUserId, 
  docId, setDocId, 
  status, connect, disconnect,
  rightPanel, setRightPanel,
}) {
  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';

  return (
    <header style={styles.header} className="glass-panel">
      <div style={styles.logo}>
        <div style={styles.logoIcon}>
          <Zap size={16} fill="currentColor" />
        </div>
        <span>Sync Engine</span>
      </div>
      
      <div style={styles.controls}>
        {/* Panel toggle */}
        {isConnected && (
          <div style={styles.toggleGroup}>
            <button
              className="btn"
              onClick={() => setRightPanel('logs')}
              style={{
                ...styles.toggleBtn,
                background: rightPanel === 'logs' ? 'var(--accent)' : 'var(--surface-2)',
              }}
              title="Operation Log"
            >
              <Activity size={13} />
            </button>
            <button
              className="btn"
              onClick={() => setRightPanel('history')}
              style={{
                ...styles.toggleBtn,
                background: rightPanel === 'history' ? 'var(--accent)' : 'var(--surface-2)',
              }}
              title="Version History"
            >
              <History size={13} />
            </button>
          </div>
        )}

        <input 
          className="input-field"
          type="text" 
          placeholder="User ID" 
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          disabled={isConnected || isConnecting}
          style={{ width: '120px' }}
        />
        <input 
          className="input-field"
          type="text" 
          placeholder="Document ID" 
          value={docId}
          onChange={(e) => setDocId(e.target.value)}
          disabled={isConnected || isConnecting}
          style={{ width: '120px' }}
        />
        
        {isConnected ? (
          <button className="btn" onClick={disconnect} style={{ background: 'var(--surface-2)' }}>
            Disconnect
          </button>
        ) : (
          <button 
            className="btn" 
            onClick={connect} 
            disabled={isConnecting || !userId || !docId}
          >
            {isConnecting ? 'Connecting...' : 'Connect'}
          </button>
        )}
      </div>
    </header>
  );
}

const styles = {
  header: {
    padding: '16px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottom: 'none',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontWeight: '700',
    fontSize: '18px',
    letterSpacing: '-0.5px',
  },
  logoIcon: {
    width: '32px',
    height: '32px',
    background: 'linear-gradient(135deg, var(--accent), #a78bfa)',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  toggleGroup: {
    display: 'flex',
    gap: '2px',
    background: 'var(--surface-2)',
    borderRadius: '6px',
    padding: '2px',
    border: '1px solid var(--border)',
  },
  toggleBtn: {
    padding: '5px 8px',
    borderRadius: '4px',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '11px',
    cursor: 'pointer',
    transition: 'all 0.15s',
    minWidth: 'unset',
  },
};
