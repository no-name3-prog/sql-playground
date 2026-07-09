import { useState } from 'react';
import { ChevronRight, Table2, RefreshCw, Columns3 } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

export function SchemaBrowser() {
  const schema = useAppStore((s) => s.schema);
  const schemaLoading = useAppStore((s) => s.schemaLoading);
  const refreshSchema = useAppStore((s) => s.refreshSchema);
  const insertSnippet = useAppStore((s) => s.insertSnippet);
  const activeConnectionId = useAppStore((s) => s.activeConnectionId);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (!activeConnectionId) {
    return (
      <div className="empty-state" style={{ height: 'auto', paddingTop: 40 }}>
        <p>Select a connection to browse its schema.</p>
      </div>
    );
  }

  if (schemaLoading) {
    return (
      <div className="empty-state" style={{ height: 'auto', paddingTop: 40 }}>
        <div className="spinner" />
        <p>Loading schema…</p>
      </div>
    );
  }

  if (!schema || schema.tables.length === 0) {
    return (
      <div className="empty-state" style={{ height: 'auto', paddingTop: 40 }}>
        <p>No tables found.</p>
        <button className="btn btn-outline btn-sm" onClick={() => refreshSchema()}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="sidebar-section-title">
        <span>
          Tables · {schema.tables.length}
        </span>
        <button className="btn-icon btn-sm" onClick={() => refreshSchema()} title="Refresh schema">
          <RefreshCw size={12} />
        </button>
      </div>

      {schema.tables.map((table) => {
        const isOpen = open[table.name] ?? false;
        return (
          <div key={table.name} className="table-item">
            <button
              className="table-header"
              onClick={() => setOpen((s) => ({ ...s, [table.name]: !isOpen }))}
              onDoubleClick={() =>
                insertSnippet(`SELECT * FROM ${table.name} LIMIT 100;`)
              }
              title="Double-click to insert SELECT"
            >
              <ChevronRight size={14} className={`chevron ${isOpen ? 'open' : ''}`} />
              <Table2 size={14} className="table-icon" />
              <span style={{ flex: 1 }}>{table.name}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {table.columns.length}
              </span>
            </button>
            {isOpen && (
              <div className="column-list">
                {table.columns.map((col) => (
                  <div
                    key={col.name}
                    className="column-row"
                    onDoubleClick={() => insertSnippet(col.name)}
                    title="Double-click to insert column name"
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Columns3 size={11} style={{ opacity: 0.5 }} />
                      {col.name}
                    </span>
                    <span className="column-type">{col.type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
