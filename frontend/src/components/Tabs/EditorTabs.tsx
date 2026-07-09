import { Plus, X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

export function EditorTabs() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const addTab = useAppStore((s) => s.addTab);

  return (
    <div className="editor-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`editor-tab ${tab.id === activeTabId ? 'active' : ''}`}
          onClick={() => setActiveTab(tab.id)}
        >
          <span className="tab-title">{tab.title}</span>
          {tabs.length > 1 && (
            <span
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              role="button"
              aria-label="Close tab"
            >
              <X size={12} />
            </span>
          )}
        </button>
      ))}
      <button className="tab-add" onClick={addTab} title="New tab">
        <Plus size={14} />
      </button>
    </div>
  );
}
