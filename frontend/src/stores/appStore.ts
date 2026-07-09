import { create } from 'zustand';
import { api } from '../api/client';
import type {
  ConnectionConfig,
  EditorTab,
  HistoryEntry,
  OptimizationReport,
  QueryAnalysis,
  QueryError,
  QueryResult,
  SchemaInfo,
} from '../types';

function uid() {
  return crypto.randomUUID();
}

function defaultSql(engine?: string) {
  if (engine === 'duckdb') {
    return `-- Welcome to SQL Query Playground
-- Sample Analytics (DuckDB)

SELECT
  u.username,
  u.plan,
  COUNT(e.id) AS event_count,
  COUNT(DISTINCT e.session_id) AS sessions
FROM users u
LEFT JOIN events e ON e.user_id = u.id
GROUP BY u.username, u.plan
ORDER BY event_count DESC;
`;
  }
  return `-- Welcome to SQL Query Playground
-- Explore the sample e-commerce database

SELECT
  c.name AS customer,
  c.country,
  COUNT(o.id) AS order_count,
  ROUND(SUM(o.total), 2) AS revenue
FROM customers c
JOIN orders o ON o.customer_id = c.id
WHERE o.status = 'completed'
GROUP BY c.name, c.country
ORDER BY revenue DESC;
`;
}

interface AppState {
  connections: ConnectionConfig[];
  activeConnectionId: string | null;
  schema: SchemaInfo | null;
  schemaLoading: boolean;
  tabs: EditorTab[];
  activeTabId: string;
  history: HistoryEntry[];
  sidebarTab: 'schema' | 'history' | 'connections';
  loadingConnections: boolean;
  errorBanner: string | null;

  init: () => Promise<void>;
  setSidebarTab: (t: 'schema' | 'history' | 'connections') => void;
  setActiveConnection: (id: string) => Promise<void>;
  refreshConnections: () => Promise<void>;
  refreshSchema: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  clearHistory: () => Promise<void>;

  addTab: () => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTabSql: (id: string, sql: string) => void;
  renameTab: (id: string, title: string) => void;

  runQuery: () => Promise<void>;
  loadHistoryIntoTab: (entry: HistoryEntry) => void;
  insertSnippet: (sql: string) => void;
  setResultsView: (view: 'results' | 'analysis' | 'optimize') => void;
  applyRewrite: (sql: string) => void;
  setErrorBanner: (msg: string | null) => void;
}

const firstTabId = uid();

export const useAppStore = create<AppState>((set, get) => ({
  connections: [],
  activeConnectionId: null,
  schema: null,
  schemaLoading: false,
  tabs: [
    {
      id: firstTabId,
      title: 'Query 1',
      sql: defaultSql('sqlite'),
      connectionId: null,
      result: null,
      error: null,
      analysis: null,
      analysisError: null,
      optimization: null,
      optimizationError: null,
      isRunning: false,
      resultsView: 'results',
    },
  ],
  activeTabId: firstTabId,
  history: [],
  sidebarTab: 'schema',
  loadingConnections: true,
  errorBanner: null,

  init: async () => {
    try {
      const connections = await api.listConnections();
      const sample =
        connections.find((c) => c.isSample && c.engine === 'sqlite') ||
        connections[0] ||
        null;

      set((s) => ({
        connections,
        activeConnectionId: sample?.id ?? null,
        loadingConnections: false,
        tabs: s.tabs.map((t, i) =>
          i === 0
            ? {
                ...t,
                connectionId: sample?.id ?? null,
                sql: defaultSql(sample?.engine),
              }
            : t
        ),
      }));

      if (sample) {
        await get().refreshSchema();
      }
      await get().refreshHistory();
    } catch (err) {
      set({
        loadingConnections: false,
        errorBanner:
          err instanceof Error
            ? err.message
            : 'Failed to connect to API. Is the backend running?',
      });
    }
  },

  setSidebarTab: (sidebarTab) => set({ sidebarTab }),

  setActiveConnection: async (id) => {
    set({ activeConnectionId: id });
    const tabId = get().activeTabId;
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, connectionId: id } : t)),
    }));
    await get().refreshSchema();
  },

  refreshConnections: async () => {
    const connections = await api.listConnections();
    set({ connections });
  },

  refreshSchema: async () => {
    const id = get().activeConnectionId;
    if (!id) {
      set({ schema: null });
      return;
    }
    set({ schemaLoading: true });
    try {
      const schema = await api.getSchema(id);
      set({ schema, schemaLoading: false });
    } catch {
      set({ schema: null, schemaLoading: false });
    }
  },

  refreshHistory: async () => {
    try {
      const history = await api.getHistory();
      set({ history });
    } catch {
      /* ignore */
    }
  },

  clearHistory: async () => {
    await api.clearHistory();
    set({ history: [] });
  },

  addTab: () => {
    const n = get().tabs.length + 1;
    const connId = get().activeConnectionId;
    const tab: EditorTab = {
      id: uid(),
      title: `Query ${n}`,
      sql: '-- New query\nSELECT 1 AS n;\n',
      connectionId: connId,
      result: null,
      error: null,
      analysis: null,
      analysisError: null,
      optimization: null,
      optimizationError: null,
      isRunning: false,
      resultsView: 'results',
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  },

  closeTab: (id) => {
    const { tabs, activeTabId } = get();
    if (tabs.length === 1) return;
    const idx = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    let newActive = activeTabId;
    if (activeTabId === id) {
      newActive = next[Math.max(0, idx - 1)].id;
    }
    set({ tabs: next, activeTabId: newActive });
  },

  setActiveTab: (id) => {
    set({ activeTabId: id });
    const tab = get().tabs.find((t) => t.id === id);
    if (tab?.connectionId && tab.connectionId !== get().activeConnectionId) {
      get().setActiveConnection(tab.connectionId);
    }
  },

  updateTabSql: (id, sql) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, sql } : t)),
    }));
  },

  renameTab: (id, title) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    }));
  },

  runQuery: async () => {
    const { activeTabId, tabs, activeConnectionId } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    const connectionId = tab.connectionId || activeConnectionId;
    if (!connectionId) {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === activeTabId
            ? {
                ...t,
                error: { message: 'Select a database connection first' },
                result: null,
                analysis: null,
                analysisError: null,
                optimization: null,
                optimizationError: null,
              }
            : t
        ),
      }));
      return;
    }

    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, isRunning: true, error: null, connectionId }
          : t
      ),
    }));

    try {
      const response = await api.executeQuery(connectionId, tab.sql);
      const result: QueryResult | null = response.result ?? null;
      const error: QueryError | null = response.error ?? null;
      const analysis: QueryAnalysis | null = response.analysis ?? null;
      const optimization: OptimizationReport | null = response.optimization ?? null;

      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === activeTabId
            ? {
                ...t,
                isRunning: false,
                result: response.success ? result : null,
                error: response.success ? null : error,
                analysis: response.success ? analysis : null,
                analysisError: response.success
                  ? response.analysisError ?? null
                  : null,
                optimization: response.success ? optimization : null,
                optimizationError: response.success
                  ? response.optimizationError ?? null
                  : null,
              }
            : t
        ),
      }));
      await get().refreshHistory();
    } catch (err) {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === activeTabId
            ? {
                ...t,
                isRunning: false,
                result: null,
                analysis: null,
                analysisError: null,
                optimization: null,
                optimizationError: null,
                error: {
                  message: err instanceof Error ? err.message : 'Request failed',
                },
              }
            : t
        ),
      }));
    }
  },

  loadHistoryIntoTab: (entry) => {
    const tab: EditorTab = {
      id: uid(),
      title: 'History',
      sql: entry.sql,
      connectionId: entry.connectionId,
      result: null,
      error: null,
      analysis: null,
      analysisError: null,
      optimization: null,
      optimizationError: null,
      isRunning: false,
      resultsView: 'results',
    };
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
      activeConnectionId: entry.connectionId,
    }));
    get().refreshSchema();
  },

  insertSnippet: (sql) => {
    const { activeTabId, tabs } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    const next = tab.sql.trim() ? `${tab.sql.replace(/\s*$/, '')}\n\n${sql}` : sql;
    get().updateTabSql(activeTabId, next);
  },

  setResultsView: (view) => {
    const { activeTabId } = get();
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId ? { ...t, resultsView: view } : t
      ),
    }));
  },

  applyRewrite: (sql: string) => {
    const { activeTabId } = get();
    get().updateTabSql(activeTabId, sql);
  },

  setErrorBanner: (msg) => set({ errorBanner: msg }),
}));
