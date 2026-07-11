import React from 'react';
import { Users } from 'lucide-react';

export function AwarenessBar({ activeUsers, typingUsers, currentUserId }) {
  if (!activeUsers || activeUsers.length === 0) return null;

  // Ensure current user is first in the list
  const sortedUsers = [...activeUsers].sort((a, b) => {
    if (a.userId === currentUserId) return -1;
    if (b.userId === currentUserId) return 1;
    return a.userId.localeCompare(b.userId);
  });

  return (
    <div style={styles.container}>
      <div style={styles.label}>
        <Users size={12} />
        <span>{activeUsers.length} in room</span>
      </div>

      <div style={styles.avatars}>
        {sortedUsers.map(u => {
          const isTyping = typingUsers.has(u.userId);
          const isMe = u.userId === currentUserId;
          const initials = u.userId.slice(0, 2).toUpperCase();

          return (
            <div key={u.userId} style={styles.avatarWrapper}>
              <div 
                style={{ 
                  ...styles.avatar, 
                  backgroundColor: u.color,
                  borderColor: isMe ? '#fff' : 'transparent',
                }}
                title={`${u.userId}${isMe ? ' (You)' : ''}`}
              >
                {initials}
              </div>
              
              {/* Typing indicator bubble */}
              {isTyping && (
                <div style={styles.typingIndicator}>
                  <span style={{...styles.dot, animationDelay: '0ms'}}></span>
                  <span style={{...styles.dot, animationDelay: '150ms'}}></span>
                  <span style={{...styles.dot, animationDelay: '300ms'}}></span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 16px',
    background: 'var(--surface-1)',
    borderBottom: '1px solid var(--border)',
    fontSize: '11px',
    color: 'var(--text-dim)',
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  avatars: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  avatarWrapper: {
    position: 'relative',
    display: 'flex',
    justifyContent: 'center',
  },
  avatar: {
    width: '24px',
    height: '24px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontWeight: '700',
    fontSize: '10px',
    border: '2px solid transparent',
    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    cursor: 'default',
  },
  typingIndicator: {
    position: 'absolute',
    top: '-6px',
    right: '-6px',
    background: 'var(--surface-3)',
    borderRadius: '10px',
    padding: '2px 4px',
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    border: '1px solid var(--border)',
    boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
  },
  dot: {
    width: '3px',
    height: '3px',
    backgroundColor: 'var(--text)',
    borderRadius: '50%',
    animation: 'typing-bounce 1s infinite',
  }
};
