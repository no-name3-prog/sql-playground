import type {
  ConnectionConfig,
  CreateConnectionInput,
  ExecuteQueryResponse,
  HistoryEntry,
  OptimizationReport,
  QueryAnalysis,
  SchemaInfo,
} from '../types';

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !('success' in data)) {
    throw new Error(
      typeof data.error === 'string'
        ? data.error
        : data.error?.message || data.message || `HTTP ${res.status}`
    );
  }
  return data as T;
}

export const api = {
  health: () => request<{ status: string }>('/health'),

  listConnections: () =>
    request<{ connections: ConnectionConfig[] }>('/connections').then((r) => r.connections),

  createConnection: (input: CreateConnectionInput) =>
    request<{ connection: ConnectionConfig }>('/connections', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => r.connection),

  deleteConnection: (id: string) =>
    request<{ ok: boolean }>(`/connections/${id}`, { method: 'DELETE' }),

  executeQuery: (connectionId: string, sql: string, maxRows = 1000) =>
    request<ExecuteQueryResponse>('/query/execute', {
      method: 'POST',
      body: JSON.stringify({ connectionId, sql, maxRows, analyze: true }),
    }),

  analyzeQuery: (connectionId: string, sql: string) =>
    request<{
      success: boolean;
      analysis?: QueryAnalysis;
      optimization?: OptimizationReport;
      error?: { message: string };
    }>('/query/analyze', {
      method: 'POST',
      body: JSON.stringify({ connectionId, sql }),
    }),

  optimizeQuery: (connectionId: string, sql: string) =>
    request<{
      success: boolean;
      optimization?: OptimizationReport;
      analysis?: QueryAnalysis;
      error?: { message: string };
    }>('/query/optimize', {
      method: 'POST',
      body: JSON.stringify({ connectionId, sql }),
    }),

  getSchema: (connectionId: string) =>
    request<{ schema: SchemaInfo }>(`/query/schema/${connectionId}`).then((r) => r.schema),

  getHistory: (limit = 50) =>
    request<{ history: HistoryEntry[] }>(`/history?limit=${limit}`).then((r) => r.history),

  clearHistory: () => request<{ ok: boolean }>('/history', { method: 'DELETE' }),
};
