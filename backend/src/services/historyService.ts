import { v4 as uuid } from 'uuid';
import type { DatabaseEngine, HistoryEntry } from '../types/index.js';

const MAX_HISTORY = 200;

class HistoryService {
  private entries: HistoryEntry[] = [];

  add(entry: Omit<HistoryEntry, 'id' | 'executedAt'>): HistoryEntry {
    const full: HistoryEntry = {
      ...entry,
      id: uuid(),
      executedAt: new Date().toISOString(),
    };
    this.entries.unshift(full);
    if (this.entries.length > MAX_HISTORY) {
      this.entries = this.entries.slice(0, MAX_HISTORY);
    }
    return full;
  }

  list(limit = 50): HistoryEntry[] {
    return this.entries.slice(0, limit);
  }

  clear(): void {
    this.entries = [];
  }

  get(id: string): HistoryEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }
}

export const historyService = new HistoryService();
export type { HistoryEntry, DatabaseEngine };
