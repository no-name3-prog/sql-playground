import { useRef, useEffect } from 'react';
import Editor, { OnMount, loader } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useAppStore } from '../../stores/appStore';
import { useThemeStore } from '../../stores/themeStore';

// Prefer CDN for monaco workers reliability
loader.config({
  paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs' },
});

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL',
  'ON', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'IS', 'NULL',
  'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'AS', 'DISTINCT',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE',
  'DROP', 'ALTER', 'INDEX', 'VIEW', 'WITH', 'UNION', 'ALL', 'CASE', 'WHEN',
  'THEN', 'ELSE', 'END', 'CAST', 'COALESCE', 'COUNT', 'SUM', 'AVG', 'MIN',
  'MAX', 'ROUND', 'ASC', 'DESC', 'TRUE', 'FALSE', 'PRIMARY', 'KEY', 'FOREIGN',
  'REFERENCES', 'CONSTRAINT', 'DEFAULT', 'CHECK', 'UNIQUE', 'EXPLAIN', 'ANALYZE',
];

export function SqlEditor() {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const updateTabSql = useAppStore((s) => s.updateTabSql);
  const runQuery = useAppStore((s) => s.runQuery);
  const schema = useAppStore((s) => s.schema);
  const theme = useThemeStore((s) => s.theme);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const sql = activeTab?.sql ?? '';
  const isRunning = activeTab?.isRunning ?? false;

  // Keep editor value in sync when switching tabs
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const current = ed.getValue();
    if (current !== sql) {
      ed.setValue(sql);
    }
  }, [activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Schema-aware autocomplete
  useEffect(() => {
    let disposable: { dispose: () => void } | null = null;

    async function register() {
      const monaco = await loader.init();
      disposable = monaco.languages.registerCompletionItemProvider('sql', {
        triggerCharacters: ['.', ' ', ','],
        provideCompletionItems: (model: editor.ITextModel, position: import('monaco-editor').Position) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

          const suggestions: import('monaco-editor').languages.CompletionItem[] = [];

          for (const kw of SQL_KEYWORDS) {
            suggestions.push({
              label: kw,
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: kw,
              range,
              detail: 'keyword',
            });
          }

          if (schema?.tables) {
            for (const table of schema.tables) {
              suggestions.push({
                label: table.name,
                kind: monaco.languages.CompletionItemKind.Class,
                insertText: table.name,
                range,
                detail: 'table',
              });
              for (const col of table.columns) {
                suggestions.push({
                  label: `${table.name}.${col.name}`,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: col.name,
                  range,
                  detail: `${table.name} · ${col.type}`,
                });
                suggestions.push({
                  label: col.name,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: col.name,
                  range,
                  detail: col.type,
                });
              }
            }
          }

          return { suggestions };
        },
      });
    }

    register();
    return () => disposable?.dispose();
  }, [schema]);

  const onMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance;

    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      runQuery();
    });

    // custom themes
    monaco.editor.defineTheme('sql-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '6B8CFF', fontStyle: 'bold' },
        { token: 'string', foreground: '34D399' },
        { token: 'number', foreground: 'FBBF24' },
        { token: 'comment', foreground: '6B7385', fontStyle: 'italic' },
      ],
      colors: {
        'editor.background': '#0f1117',
        'editor.lineHighlightBackground': '#1c212b',
        'editorLineNumber.foreground': '#4a5264',
        'editorCursor.foreground': '#6B8CFF',
        'editor.selectionBackground': '#2c3342',
      },
    });

    monaco.editor.defineTheme('sql-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '3B6CF0', fontStyle: 'bold' },
        { token: 'string', foreground: '0D9F6E' },
        { token: 'number', foreground: 'D97706' },
        { token: 'comment', foreground: '8B93A7', fontStyle: 'italic' },
      ],
      colors: {
        'editor.background': '#f4f5f7',
        'editor.lineHighlightBackground': '#eef0f4',
        'editorLineNumber.foreground': '#8b93a7',
        'editorCursor.foreground': '#3B6CF0',
      },
    });

    monaco.editor.setTheme(theme === 'dark' ? 'sql-dark' : 'sql-light');
  };

  useEffect(() => {
    loader.init().then((monaco) => {
      monaco.editor.setTheme(theme === 'dark' ? 'sql-dark' : 'sql-light');
    });
  }, [theme]);

  return (
    <>
      <Editor
        height="100%"
        language="sql"
        defaultValue={sql}
        theme={theme === 'dark' ? 'sql-dark' : 'sql-light'}
        onMount={onMount}
        onChange={(value) => {
          if (activeTabId) updateTabSql(activeTabId, value ?? '');
        }}
        options={{
          fontSize: 13.5,
          fontFamily: "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace",
          fontLigatures: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: 'on',
          lineNumbers: 'on',
          renderLineHighlight: 'line',
          padding: { top: 12, bottom: 12 },
          suggestOnTriggerCharacters: true,
          quickSuggestions: true,
          scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
          overviewRulerLanes: 0,
        }}
      />
      {isRunning && (
        <div className="running-overlay">
          <div className="running-pill">
            <div className="spinner" />
            Executing query…
          </div>
        </div>
      )}
    </>
  );
}
