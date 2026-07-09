import { useCallback, useEffect, useState } from 'react';
import {
  Network,
  RefreshCw,
  Table2,
  Eye,
  KeyRound,
  Link2,
  X,
} from 'lucide-react';
import { api } from '../../api/client';
import type { ObjectDetails, SchemaCatalog } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { SchemaGraph } from './SchemaGraph';
import { ObjectDetail } from './ObjectDetail';

export function SchemaExplorer() {
  const connectionId = useAppStore((s) => s.activeConnectionId);
  const insertSnippet = useAppStore((s) => s.insertSnippet);
  const setWorkspaceMode = useAppStore((s) => s.setWorkspaceMode);

  const [catalog, setCatalog] = useState<SchemaCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<ObjectDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    if (!connectionId) return;
    setLoading(true);
    setError(null);
    try {
      const cat = await api.getCatalog(connectionId);
      setCatalog(cat);
      if (!selectedId && cat.objects[0]) {
        setSelectedId(cat.objects[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load catalog');
      setCatalog(null);
    } finally {
      setLoading(false);
    }
  }, [connectionId, selectedId]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  useEffect(() => {
    if (!connectionId || !selectedId || !catalog) {
      setDetails(null);
      return;
    }
    const obj = catalog.objects.find((o) => o.id === selectedId);
    if (!obj) return;

    let cancelled = false;
    (async () => {
      setDetailsLoading(true);
      setDetailsError(null);
      try {
        const d = await api.getObjectDetails(connectionId, obj.name, obj.kind);
        if (!cancelled) setDetails(d);
      } catch (err) {
        if (!cancelled) {
          setDetails(null);
          setDetailsError(err instanceof Error ? err.message : 'Failed to load details');
        }
      } finally {
        if (!cancelled) setDetailsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionId, selectedId, catalog]);

  if (!connectionId) {
    return (
      <div className="explorer-root">
        <div className="empty-state">
          <p>Select a database connection to explore its schema.</p>
        </div>
      </div>
    );
  }

  const q = filter.trim().toLowerCase();
  const objects =
    catalog?.objects.filter(
      (o) =>
        !q ||
        o.name.toLowerCase().includes(q) ||
        o.columns.some((c) => c.name.toLowerCase().includes(q))
    ) ?? [];

  return (
    <div className="explorer-root">
      <div className="explorer-toolbar">
        <div className="explorer-title">
          <Network size={16} />
          Schema Explorer
          {catalog && (
            <span className="muted">
              {catalog.engine} · {catalog.objects.length} objects ·{' '}
              {catalog.foreignKeys.length} FKs · {catalog.indexes.length} indexes
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="input"
            placeholder="Filter tables / columns…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: 200, height: 30 }}
          />
          <button className="btn btn-outline btn-sm" onClick={() => load()} disabled={loading}>
            <RefreshCw size={12} className={loading ? 'spin' : undefined} /> Refresh
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setWorkspaceMode('query')}>
            <X size={14} /> Back to query
          </button>
        </div>
      </div>

      {error && <div className="error-panel" style={{ margin: 12 }}>{error}</div>}

      {loading && !catalog ? (
        <div className="empty-state">
          <div className="spinner" />
          <p>Discovering schema…</p>
        </div>
      ) : (
        <div className="explorer-body">
          <aside className="explorer-list">
            <div className="sidebar-section-title">Objects</div>
            {objects.map((o) => (
              <button
                key={o.id}
                className={`explorer-obj ${selectedId === o.id ? 'active' : ''}`}
                onClick={() => setSelectedId(o.id)}
              >
                {o.kind === 'view' ? <Eye size={13} /> : <Table2 size={13} />}
                <span className="obj-name">{o.name}</span>
                <span className="muted">{o.columns.length}</span>
              </button>
            ))}
            {catalog && (
              <>
                <div className="sidebar-section-title" style={{ marginTop: 12 }}>
                  <Link2 size={11} /> Relationships
                </div>
                {catalog.foreignKeys.slice(0, 40).map((fk) => (
                  <div key={fk.id} className="explorer-fk">
                    <KeyRound size={11} />
                    <span>
                      {fk.fromTable} → {fk.toTable}
                    </span>
                  </div>
                ))}
              </>
            )}
          </aside>

          <div className="explorer-graph-pane">
            <SchemaGraph
              nodes={catalog?.graph.nodes ?? []}
              edges={catalog?.graph.edges ?? []}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>

          <aside className="explorer-detail-pane">
            <ObjectDetail
              details={details}
              loading={detailsLoading}
              error={detailsError}
              onInsertSelect={(name) => {
                insertSnippet(`SELECT * FROM ${name} LIMIT 100;`);
                setWorkspaceMode('query');
              }}
            />
          </aside>
        </div>
      )}
    </div>
  );
}
