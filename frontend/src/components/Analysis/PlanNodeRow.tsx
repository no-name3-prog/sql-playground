import { memo, useState } from 'react';
import { ChevronRight, AlertTriangle } from 'lucide-react';
import type { OperatorCategory, PlanNode } from '../../types';
import { CATEGORY_META } from './categoryStyles';

interface Props {
  node: PlanNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Collapse children when subtree is large and depth is high */
  autoCollapseDepth: number;
  autoCollapseSubtree: number;
  filterCategories: Set<OperatorCategory> | null;
  focusExpensive: boolean;
  search: string;
}

function matchesFilter(
  node: PlanNode,
  filterCategories: Set<OperatorCategory> | null,
  focusExpensive: boolean,
  search: string
): boolean {
  if (focusExpensive && !node.isExpensive) {
    // keep if any descendant is expensive
    if (!hasExpensiveDescendant(node)) return false;
  }
  if (filterCategories && filterCategories.size > 0) {
    if (!filterCategories.has(node.category) && !hasCategoryDescendant(node, filterCategories)) {
      return false;
    }
  }
  if (search.trim()) {
    const q = search.toLowerCase();
    const hay = `${node.label} ${node.operator} ${node.detail || ''} ${node.explanation}`.toLowerCase();
    if (!hay.includes(q) && !hasSearchDescendant(node, q)) return false;
  }
  return true;
}

function hasExpensiveDescendant(node: PlanNode): boolean {
  return node.children.some((c) => c.isExpensive || hasExpensiveDescendant(c));
}

function hasCategoryDescendant(node: PlanNode, cats: Set<OperatorCategory>): boolean {
  return node.children.some(
    (c) => cats.has(c.category) || hasCategoryDescendant(c, cats)
  );
}

function hasSearchDescendant(node: PlanNode, q: string): boolean {
  return node.children.some((c) => {
    const hay = `${c.label} ${c.operator} ${c.detail || ''}`.toLowerCase();
    return hay.includes(q) || hasSearchDescendant(c, q);
  });
}

export const PlanNodeRow = memo(function PlanNodeRow({
  node,
  depth,
  selectedId,
  onSelect,
  autoCollapseDepth,
  autoCollapseSubtree,
  filterCategories,
  focusExpensive,
  search,
}: Props) {
  const shouldAutoCollapse =
    depth >= autoCollapseDepth || node.subtreeSize >= autoCollapseSubtree;
  const [expanded, setExpanded] = useState(!shouldAutoCollapse && depth < 3);
  const meta = CATEGORY_META[node.category];
  const selected = selectedId === node.id;
  const hasChildren = node.children.length > 0;

  if (!matchesFilter(node, filterCategories, focusExpensive, search)) {
    return null;
  }

  const visibleChildren = node.children;

  return (
    <div className="plan-node-block">
      <div
        className={`plan-node-row ${selected ? 'selected' : ''} ${node.isExpensive ? 'expensive' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => onSelect(node.id)}
        role="treeitem"
        aria-expanded={hasChildren ? expanded : undefined}
      >
        <button
          className="plan-chevron-btn"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) setExpanded((v) => !v);
          }}
          disabled={!hasChildren}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {hasChildren ? (
            <ChevronRight size={14} className={`plan-chevron ${expanded ? 'open' : ''}`} />
          ) : (
            <span className="plan-chevron-spacer" />
          )}
        </button>

        <span
          className="plan-cat-dot"
          style={{ background: meta.color }}
          title={meta.label}
        />

        <span className="plan-node-label">{node.label}</span>

        {node.detail && (
          <span className="plan-node-detail" title={node.detail}>
            {node.detail}
          </span>
        )}

        <span className="plan-node-meta">
          {node.estimatedRows !== undefined && (
            <span className="plan-chip" title="Estimated rows">
              ~{formatRows(node.estimatedRows)} rows
            </span>
          )}
          {hasChildren && !expanded && node.subtreeSize > 1 && (
            <span className="plan-chip muted" title="Collapsed subtree size">
              +{node.subtreeSize - 1} ops
            </span>
          )}
          {node.isExpensive && (
            <span className="plan-chip hot" title="Dominant cost contributor">
              <AlertTriangle size={10} /> hot
            </span>
          )}
        </span>

        <span className="plan-cost-wrap" title={`${node.costPercent}% of estimated plan cost`}>
          <span className="plan-cost-bar">
            <span
              className={`plan-cost-fill ${node.isExpensive ? 'hot' : ''}`}
              style={{ width: `${Math.min(100, Math.max(2, node.costPercent))}%` }}
            />
          </span>
          <span className="plan-cost-pct">{node.costPercent.toFixed(0)}%</span>
        </span>
      </div>

      {expanded &&
        visibleChildren.map((child) => (
          <PlanNodeRow
            key={child.id}
            node={child}
            depth={depth + 1}
            selectedId={selectedId}
            onSelect={onSelect}
            autoCollapseDepth={autoCollapseDepth}
            autoCollapseSubtree={autoCollapseSubtree}
            filterCategories={filterCategories}
            focusExpensive={focusExpensive}
            search={search}
          />
        ))}
    </div>
  );
});

function formatRows(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}
