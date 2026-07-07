import React from 'react';
import { Zap } from 'lucide-react';

export function Header({ 
  userId, setUserId, 
  docId, setDocId, 
  status, connect, disconnect 
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
  }
};
