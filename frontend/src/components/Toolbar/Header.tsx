import { Database, Moon, Sun, Github, Network } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useAppStore } from '../../stores/appStore';

export function Header() {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  const workspaceMode = useAppStore((s) => s.workspaceMode);
  const setWorkspaceMode = useAppStore((s) => s.setWorkspaceMode);

  return (
    <header className="header">
      <div className="logo">
        <div className="logo-mark">
          <Database size={15} strokeWidth={2.5} />
        </div>
        <span>SQL Query Playground</span>
      </div>
      <div className="header-center">
        <span style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>
          Understand · Execute · Optimize
        </span>
      </div>
      <div className="header-actions">
        <button
          className={`btn btn-sm ${workspaceMode === 'explorer' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() =>
            setWorkspaceMode(workspaceMode === 'explorer' ? 'query' : 'explorer')
          }
          title="Interactive schema explorer"
        >
          <Network size={14} />
          Schema
        </button>
        <button
          className="btn-icon"
          onClick={toggle}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <a
          className="btn-icon"
          href="https://github.com"
          target="_blank"
          rel="noreferrer"
          title="Documentation"
          style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }}
        >
          <Github size={16} />
        </a>
      </div>
    </header>
  );
}
