import { Trash2, Clock } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function HistoryPanel() {
  const history = useAppStore((s) => s.history);
  const clearHistory = useAppStore((s) => s.clearHistory);
  const loadHistoryIntoTab = useAppStore((s) => s.loadHistoryIntoTab);

  return (
    <div>
      <div className="sidebar-section-title">
        <span>Recent queries</span>
        {history.length > 0 && (
          <button
            className="btn-icon btn-sm"
            onClick={() => clearHistory()}
            title="Clear history"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {history.length === 0 && (
        <div className="empty-state" style={{ height: 'auto', paddingTop: 32 }}>
          <Clock size={22} strokeWidth={1.5} />
          <p>Executed queries will appear here.</p>
        </div>
      )}

      {history.map((entry) => (
        <button
          key={entry.id}
          className="history-item"
          onClick={() => loadHistoryIntoTab(entry)}
          title="Open in new tab"
        >
          <div className="history-meta">
            <span className={`history-status ${entry.success ? 'ok' : 'err'}`} />
            <span className={`engine-badge ${entry.engine}`}>{entry.engine}</span>
            <span style={{ marginLeft: 'auto' }}>{relativeTime(entry.executedAt)}</span>
          </div>
          <div className="history-sql">{entry.sql.replace(/\s+/g, ' ').trim()}</div>
          <div className="history-meta" style={{ marginTop: 6, marginBottom: 0 }}>
            {entry.success ? (
              <>
                <span>{entry.rowCount ?? 0} rows</span>
                <span>·</span>
                <span>{entry.executionTimeMs ?? 0} ms</span>
              </>
            ) : (
              <span style={{ color: 'var(--danger)' }}>Failed</span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
