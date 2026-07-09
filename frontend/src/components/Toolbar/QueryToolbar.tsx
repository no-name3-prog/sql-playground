import { Play, Loader2 } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

const ENGINE_LABEL: Record<string, string> = {
  sqlite: 'SQLite',
  duckdb: 'DuckDB',
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
};

export function QueryToolbar() {
  const connections = useAppStore((s) => s.connections);
  const activeConnectionId = useAppStore((s) => s.activeConnectionId);
  const setActiveConnection = useAppStore((s) => s.setActiveConnection);
  const runQuery = useAppStore((s) => s.runQuery);
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isRunning = activeTab?.isRunning ?? false;
  const activeConn = connections.find((c) => c.id === activeConnectionId);

  return (
    <div className="toolbar">
      <button
        className="btn btn-primary"
        onClick={() => runQuery()}
        disabled={isRunning || !activeConnectionId}
        title="Run query (⌘/Ctrl + Enter)"
      >
        {isRunning ? <Loader2 size={14} className="spin" /> : <Play size={14} fill="currentColor" />}
        Run
        <span className="kbd">⌘↵</span>
      </button>

      <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />

      <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Connection</label>
      <select
        className="select"
        value={activeConnectionId ?? ''}
        onChange={(e) => setActiveConnection(e.target.value)}
        style={{ minWidth: 220 }}
      >
        <option value="" disabled>
          Select connection…
        </option>
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {activeConn && (
        <span className={`engine-badge ${activeConn.engine}`}>
          {ENGINE_LABEL[activeConn.engine] || activeConn.engine}
        </span>
      )}

      <div className="toolbar-spacer" />

      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Multi-engine playground · SQLite · DuckDB · Postgres · MySQL
      </span>
    </div>
  );
}
