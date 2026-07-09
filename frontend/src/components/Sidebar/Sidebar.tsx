import { useAppStore } from '../../stores/appStore';
import { SchemaBrowser } from './SchemaBrowser';
import { HistoryPanel } from '../History/HistoryPanel';
import { ConnectionsPanel } from '../ConnectionPicker/ConnectionsPanel';

export function Sidebar() {
  const sidebarTab = useAppStore((s) => s.sidebarTab);
  const setSidebarTab = useAppStore((s) => s.setSidebarTab);

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs">
        {(
          [
            ['schema', 'Schema'],
            ['history', 'History'],
            ['connections', 'Connect'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={`sidebar-tab ${sidebarTab === id ? 'active' : ''}`}
            onClick={() => setSidebarTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="sidebar-body">
        {sidebarTab === 'schema' && <SchemaBrowser />}
        {sidebarTab === 'history' && <HistoryPanel />}
        {sidebarTab === 'connections' && <ConnectionsPanel />}
      </div>
    </aside>
  );
}
