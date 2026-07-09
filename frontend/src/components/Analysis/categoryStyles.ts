import type { OperatorCategory } from '../../types';

export const CATEGORY_META: Record<
  OperatorCategory,
  { label: string; color: string; soft: string }
> = {
  scan: { label: 'Scan', color: '#0ea5e9', soft: 'rgba(14, 165, 233, 0.15)' },
  join: { label: 'Join', color: '#a855f7', soft: 'rgba(168, 85, 247, 0.15)' },
  sort: { label: 'Sort', color: '#f59e0b', soft: 'rgba(245, 158, 11, 0.15)' },
  aggregate: { label: 'Aggregate', color: '#10b981', soft: 'rgba(16, 185, 129, 0.15)' },
  filter: { label: 'Filter', color: '#6366f1', soft: 'rgba(99, 102, 241, 0.15)' },
  project: { label: 'Project', color: '#64748b', soft: 'rgba(100, 116, 139, 0.12)' },
  limit: { label: 'Limit', color: '#94a3b8', soft: 'rgba(148, 163, 184, 0.15)' },
  materialize: { label: 'Materialize', color: '#ec4899', soft: 'rgba(236, 72, 153, 0.12)' },
  modify: { label: 'Modify', color: '#ef4444', soft: 'rgba(239, 68, 68, 0.12)' },
  other: { label: 'Other', color: '#8b93a7', soft: 'rgba(139, 147, 167, 0.12)' },
};

export const ALL_CATEGORIES = Object.keys(CATEGORY_META) as OperatorCategory[];
