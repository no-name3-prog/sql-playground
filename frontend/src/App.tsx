import { useEffect, useCallback, useRef, useState } from 'react';
import { useAppStore } from './stores/appStore';
import { useThemeStore } from './stores/themeStore';
import { Header } from './components/Toolbar/Header';
import { Sidebar } from './components/Sidebar/Sidebar';
import { EditorTabs } from './components/Tabs/EditorTabs';
import { QueryToolbar } from './components/Toolbar/QueryToolbar';
import { SqlEditor } from './components/Editor/SqlEditor';
import { ResultsPanel } from './components/Results/ResultsPanel';
import { X } from 'lucide-react';

export default function App() {
  const init = useAppStore((s) => s.init);
  const runQuery = useAppStore((s) => s.runQuery);
  const errorBanner = useAppStore((s) => s.errorBanner);
  const setErrorBanner = useAppStore((s) => s.setErrorBanner);
  const theme = useThemeStore((s) => s.theme);
  const splitRef = useRef<HTMLDivElement>(null);
  const [editorRatio, setEditorRatio] = useState(0.5);
  const dragging = useRef(false);

  useEffect(() => {
    init();
  }, [init]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        runQuery();
      }
    },
    [runQuery]
  );

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !splitRef.current) return;
      const rect = splitRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const ratio = Math.min(0.8, Math.max(0.2, y / rect.height));
      setEditorRatio(ratio);
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <div className="app" data-theme={theme}>
      <Header />
      {errorBanner && (
        <div className="banner">
          <span>{errorBanner}</span>
          <button className="btn-icon btn-sm" onClick={() => setErrorBanner(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      <div className="main">
        <Sidebar />
        <div className="workspace">
          <EditorTabs />
          <QueryToolbar />
          <div
            className="split"
            ref={splitRef}
            style={{
              gridTemplateRows: `minmax(120px, ${editorRatio}fr) 6px minmax(120px, ${1 - editorRatio}fr)`,
            }}
          >
            <div className="editor-pane">
              <SqlEditor />
            </div>
            <div
              className="resize-handle"
              onMouseDown={() => {
                dragging.current = true;
                document.body.style.cursor = 'row-resize';
                document.body.style.userSelect = 'none';
              }}
            />
            <ResultsPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
