import React, { useState, useEffect, useCallback, useRef } from 'react';
import { History, Clock, ChevronLeft, ChevronRight, Play, Pause } from 'lucide-react';

export function VersionHistory({ docId, currentVersion, status }) {
  const [targetVersion, setTargetVersion] = useState(currentVersion);
  const [previewDoc, setPreviewDoc] = useState('');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [foldSource, setFoldSource] = useState('');
  const [opsApplied, setOpsApplied] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playRef = useRef(null);
  const debounceRef = useRef(null);

  const isConnected = status === 'connected';

  // Fetch history metadata when docId or currentVersion changes
  useEffect(() => {
    if (!docId || !isConnected) return;
    fetch(`/api/history/${encodeURIComponent(docId)}?limit=200`)
      .then(r => r.json())
      .then(data => {
        if (data.ops) setHistory(data.ops);
      })
      .catch(() => {});
  }, [docId, currentVersion, isConnected]);

  // Keep targetVersion in sync with live version when at head
  useEffect(() => {
    setTargetVersion(prev => {
      // If we were tracking the head, keep tracking
      if (prev === currentVersion - 1 || prev === 0) return currentVersion;
      return prev;
    });
  }, [currentVersion]);

  // Fetch fold-reconstructed document (debounced)
  const fetchFold = useCallback((version) => {
    if (!docId || version < 0) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/history/${encodeURIComponent(docId)}/at/${version}`);
        const data = await res.json();
        if (data.doc !== undefined) {
          setPreviewDoc(data.doc);
          setFoldSource(data.source || 'unknown');
          setOpsApplied(data.opsApplied || 0);
        }
      } catch (e) {
        setPreviewDoc('[Error loading version]');
      } finally {
        setLoading(false);
      }
    }, 150);
  }, [docId]);

  // Fetch whenever targetVersion changes
  useEffect(() => {
    if (isConnected) fetchFold(targetVersion);
  }, [targetVersion, isConnected, fetchFold]);

  // Playback mode
  useEffect(() => {
    if (!isPlaying) {
      if (playRef.current) clearInterval(playRef.current);
      return;
    }
    playRef.current = setInterval(() => {
      setTargetVersion(prev => {
        if (prev >= currentVersion) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 300);
    return () => clearInterval(playRef.current);
  }, [isPlaying, currentVersion]);

  const handleSliderChange = (e) => {
    const v = parseInt(e.target.value, 10);
    setTargetVersion(v);
    setIsPlaying(false);
  };

  const stepVersion = (delta) => {
    setTargetVersion(prev => Math.max(0, Math.min(currentVersion, prev + delta)));
    setIsPlaying(false);
  };

  // Find the op entry for the current target version
  const currentOp = history.find(h => h.version === targetVersion);

  if (!isConnected) return null;

  return (
    <div style={styles.container} className="glass-panel">
      <div style={styles.header}>
        <History size={14} />
        <span>Version History</span>
        <span style={styles.headerBadge}>
          v{targetVersion} / {currentVersion}
        </span>
      </div>

      {/* Controls */}
      <div style={styles.controls}>
        <button
          style={styles.controlBtn}
          onClick={() => stepVersion(-1)}
          disabled={targetVersion <= 0}
          title="Previous version"
        >
          <ChevronLeft size={14} />
        </button>

        <button
          style={styles.controlBtn}
          onClick={() => setIsPlaying(!isPlaying)}
          title={isPlaying ? 'Pause replay' : 'Play replay from current position'}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>

        <button
          style={styles.controlBtn}
          onClick={() => stepVersion(1)}
          disabled={targetVersion >= currentVersion}
          title="Next version"
        >
          <ChevronRight size={14} />
        </button>

        <input
          type="range"
          min={0}
          max={currentVersion}
          value={targetVersion}
          onChange={handleSliderChange}
          style={styles.slider}
        />
      </div>

      {/* Fold info */}
      <div style={styles.foldInfo}>
        <span style={styles.foldTag}>
          {loading ? '⏳ Folding...' : `✓ ${foldSource}`}
        </span>
        {opsApplied > 0 && (
          <span style={styles.foldOps}>{opsApplied} ops folded</span>
        )}
        {currentOp && (
          <span style={styles.foldUser}>
            by <strong>{currentOp.clientId}</strong>
            {' · '}
            <span style={{ color: currentOp.type === 'insert' ? 'var(--green)' : 'var(--red)' }}>
              {currentOp.type}
            </span>
            {currentOp.type === 'insert' ? ` +${currentOp.textLength}` : ` −${currentOp.textLength}`}
          </span>
        )}
      </div>

      {/* Read-only document preview */}
      <div style={styles.previewContainer}>
        <pre style={styles.preview}>
          {targetVersion === 0
            ? <span style={styles.emptyState}>[ empty document — version 0 ]</span>
            : previewDoc || <span style={styles.emptyState}>[ empty ]</span>}
        </pre>
      </div>

      {/* Op timeline */}
      <div style={styles.timeline}>
        {history.slice().reverse().slice(0, 30).map(op => (
          <div
            key={op.version}
            style={{
              ...styles.timelineEntry,
              background: op.version === targetVersion ? 'var(--surface-2)' : 'transparent',
              borderLeft: op.version === targetVersion
                ? '2px solid var(--accent)'
                : '2px solid transparent',
            }}
            onClick={() => { setTargetVersion(op.version); setIsPlaying(false); }}
          >
            <span style={{ ...styles.opType, color: op.type === 'insert' ? 'var(--green)' : 'var(--red)' }}>
              {op.type === 'insert' ? 'INS' : 'DEL'}
            </span>
            <span style={styles.opVersion}>v{op.version}</span>
            <span style={styles.opUser}>{op.clientId}</span>
            <span style={styles.opDetail}>
              {op.type === 'insert'
                ? `+${op.textLength} "${(op.text || '').slice(0, 20)}${(op.text || '').length > 20 ? '…' : ''}"`
                : `−${op.textLength}`}
            </span>
            <span style={styles.opTime}>
              {op.timestamp ? formatTime(op.timestamp) : ''}
            </span>
          </div>
        ))}
        {history.length === 0 && (
          <div style={styles.emptyTimeline}>No operations yet</div>
        )}
      </div>
    </div>
  );
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const styles = {
  container: {
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
  headerBadge: {
    marginLeft: 'auto',
    background: 'var(--accent)',
    color: '#fff',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '10px',
    fontFamily: 'var(--font-mono)',
    fontWeight: '700',
  },
  controls: {
    padding: '10px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    borderBottom: '1px solid var(--border)',
  },
  controlBtn: {
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  slider: {
    flex: 1,
    height: '4px',
    accentColor: 'var(--accent)',
    cursor: 'pointer',
  },
  foldInfo: {
    padding: '6px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '10px',
    color: 'var(--text-dim)',
    borderBottom: '1px solid var(--border)',
    flexWrap: 'wrap',
  },
  foldTag: {
    background: 'var(--surface-2)',
    padding: '2px 6px',
    borderRadius: '3px',
    fontFamily: 'var(--font-mono)',
    fontSize: '9px',
    letterSpacing: '0.5px',
  },
  foldOps: {
    fontFamily: 'var(--font-mono)',
    fontSize: '9px',
    color: 'var(--accent)',
  },
  foldUser: {
    fontSize: '10px',
  },
  previewContainer: {
    flex: '0 0 120px',
    overflow: 'auto',
    borderBottom: '1px solid var(--border)',
  },
  preview: {
    margin: 0,
    padding: '12px 16px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    lineHeight: '1.6',
    color: 'var(--text)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    background: 'transparent',
    minHeight: '100%',
  },
  emptyState: {
    color: 'var(--border)',
    fontStyle: 'italic',
  },
  timeline: {
    flex: 1,
    overflowY: 'auto',
    padding: '4px 0',
  },
  timelineEntry: {
    padding: '5px 16px',
    fontSize: '11px',
    fontFamily: 'var(--font-mono)',
    display: 'grid',
    gridTemplateColumns: '32px 36px 70px 1fr 50px',
    gap: '8px',
    alignItems: 'center',
    cursor: 'pointer',
    transition: 'background 0.1s',
    borderBottom: '1px solid var(--border)',
  },
  opType: {
    fontWeight: '700',
    fontSize: '10px',
  },
  opVersion: {
    color: 'var(--text-dim)',
    fontSize: '10px',
  },
  opUser: {
    color: 'var(--text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '10px',
  },
  opDetail: {
    color: 'var(--text-dim)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '10px',
  },
  opTime: {
    color: 'var(--text-dim)',
    fontSize: '9px',
    textAlign: 'right',
  },
  emptyTimeline: {
    padding: '24px',
    textAlign: 'center',
    color: 'var(--border)',
    fontSize: '12px',
    fontStyle: 'italic',
  },
};
