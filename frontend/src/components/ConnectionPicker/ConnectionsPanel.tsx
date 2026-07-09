import { useState } from 'react';
import { Plus, Trash2, Database } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { api } from '../../api/client';
import type { CreateConnectionInput, DatabaseEngine } from '../../types';
import { NewConnectionModal } from './NewConnectionModal';

export function ConnectionsPanel() {
  const connections = useAppStore((s) => s.connections);
  const activeConnectionId = useAppStore((s) => s.activeConnectionId);
  const setActiveConnection = useAppStore((s) => s.setActiveConnection);
  const refreshConnections = useAppStore((s) => s.refreshConnections);
  const [showModal, setShowModal] = useState(false);

  async function handleCreate(input: CreateConnectionInput) {
    await api.createConnection(input);
    await refreshConnections();
    setShowModal(false);
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Remove this connection?')) return;
    await api.deleteConnection(id);
    await refreshConnections();
  }

  return (
    <div>
      <div className="sidebar-section-title">
        <span>Databases</span>
        <button
          className="btn btn-outline btn-sm"
          onClick={() => setShowModal(true)}
        >
          <Plus size={12} /> Add
        </button>
      </div>

      {connections.length === 0 && (
        <div className="empty-state" style={{ height: 'auto', paddingTop: 32 }}>
          <Database size={22} strokeWidth={1.5} />
          <p>No connections. Add one or run sample seed.</p>
        </div>
      )}

      {connections.map((c) => (
        <div
          key={c.id}
          className={`conn-card ${c.id === activeConnectionId ? 'active' : ''}`}
          onClick={() => setActiveConnection(c.id)}
        >
          <div className="conn-card-title">
            <span>{c.name}</span>
            {!c.isSample && (
              <button
                className="btn-icon btn-sm"
                onClick={(e) => handleDelete(c.id, e)}
                title="Remove"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
          <div className="conn-card-meta">
            <span className={`engine-badge ${c.engine}`}>{c.engine}</span>
            {c.isSample && <span className="sample-badge">Sample</span>}
            {c.host && <span>{c.host}</span>}
            {c.filename && (
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.filename.split(/[/\\]/).pop()}
              </span>
            )}
          </div>
        </div>
      ))}

      {showModal && (
        <NewConnectionModal
          onClose={() => setShowModal(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}
