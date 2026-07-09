import { useMemo, useState, useCallback } from 'react';
import {
  GitBranch,
  Flame,
  Search,
  AlertTriangle,
  Minimize2,
  Maximize2,
  Filter,
} from 'lucide-react';
import type { OperatorCategory, PlanNode, QueryAnalysis } from '../../types';
import { PlanNodeRow } from './PlanNodeRow';
import { CATEGORY_META, ALL_CATEGORIES } from './categoryStyles';

interface Props {
  analysis: QueryAnalysis;
  analysisError?: string | null;
}

function findNode(root: PlanNode, id: string): PlanNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const found = findNode(c, id);
    if (found) return found;
  }
  return null;
}

export function AnalysisPanel({ analysis, analysisError }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(
    analysis.expensiveNodes[0]?.id ?? analysis.root.id
  );
  const [search, setSearch] = useState('');
  const [focusExpensive, setFocusExpensive] = useState(false);
  const [activeCats, setActiveCats] = useState<Set<OperatorCategory>>(new Set());
  const [compact, setCompact] = useState(analysis.totalNodes > 40);

  const selected = useMemo(
    () => (selectedId ? findNode(analysis.root, selectedId) : null),
    [analysis.root, selectedId]
  );

  const filterCategories = activeCats.size > 0 ? activeCats : null;

  const toggleCat = useCallback((cat: OperatorCategory) => {
    setActiveCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const presentCategories = useMemo(() => {
    return ALL_CATEGORIES.filter((c) => (analysis.categoryCounts[c] || 0) > 0);
  }, [analysis.categoryCounts]);

  return (
    <div className="analysis-layout">
      {analysisError && (
        <div className="analysis-banner warn">
          <AlertTriangle size={14} />
          Analysis note: {analysisError}
        </div>
      )}

      <div className="analysis-summary">
        <div className="analysis-summary-text">
          <div className="analysis-summary-title">
            <GitBranch size={14} />
            Execution plan · {analysis.engine}
          </div>
          <p>{analysis.summary}</p>
        </div>
        <div className="analysis-kpis">
          <div className="kpi">
            <span className="kpi-val">{analysis.totalNodes}</span>
            <span className="kpi-lbl">operators</span>
          </div>
          <div className="kpi">
            <span className="kpi-val">{analysis.maxDepth}</span>
            <span className="kpi-lbl">depth</span>
          </div>
          <div className="kpi">
            <span className="kpi-val">{analysis.expensiveNodes.length}</span>
            <span className="kpi-lbl">hot spots</span>
          </div>
        </div>
      </div>

      {analysis.warnings.length > 0 && (
        <div className="analysis-warnings">
          {analysis.warnings.map((w, i) => (
            <div key={i} className="analysis-warning-item">
              <AlertTriangle size={12} />
              {w}
            </div>
          ))}
        </div>
      )}

      {analysis.expensiveNodes.length > 0 && (
        <div className="hotspots">
          <div className="hotspots-title">
            <Flame size={13} />
            Estimated time sinks
          </div>
          <div className="hotspots-list">
            {analysis.expensiveNodes.map((e) => (
              <button
                key={e.id}
                className={`hotspot-card ${selectedId === e.id ? 'active' : ''}`}
                onClick={() => setSelectedId(e.id)}
              >
                <div className="hotspot-top">
                  <span
                    className="plan-cat-dot"
                    style={{ background: CATEGORY_META[e.category].color }}
                  />
                  <strong>{e.label}</strong>
                  <span className="hotspot-pct">{e.costPercent.toFixed(0)}%</span>
                </div>
                <div className="hotspot-bar">
                  <span style={{ width: `${Math.min(100, e.costPercent)}%` }} />
                </div>
                {e.detail && <div className="hotspot-detail">{e.detail}</div>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="analysis-toolbar">
        <div className="analysis-search">
          <Search size={13} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter operators…"
          />
        </div>
        <button
          className={`btn btn-sm ${focusExpensive ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setFocusExpensive((v) => !v)}
          title="Show only expensive branches"
        >
          <Flame size={12} /> Hot only
        </button>
        <button
          className="btn btn-sm btn-outline"
          onClick={() => setCompact((v) => !v)}
          title="Toggle compact tree for large plans"
        >
          {compact ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
          {compact ? 'Expand more' : 'Compact'}
        </button>
        <div className="analysis-legend">
          <Filter size={12} style={{ opacity: 0.5 }} />
          {presentCategories.map((cat) => {
            const meta = CATEGORY_META[cat];
            const on = activeCats.size === 0 || activeCats.has(cat);
            return (
              <button
                key={cat}
                className={`legend-chip ${on ? 'on' : 'off'}`}
                style={{
                  borderColor: on ? meta.color : 'var(--border)',
                  background: on ? meta.soft : 'transparent',
                  color: on ? meta.color : 'var(--text-muted)',
                }}
                onClick={() => toggleCat(cat)}
                title={`${meta.label}: ${analysis.categoryCounts[cat] || 0}`}
              >
                {meta.label}
                <span className="legend-count">{analysis.categoryCounts[cat]}</span>
              </button>
            );
          })}
          {activeCats.size > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setActiveCats(new Set())}>
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="analysis-body">
        <div className="plan-tree" role="tree" aria-label="Operator tree">
          <PlanNodeRow
            node={analysis.root}
            depth={0}
            selectedId={selectedId}
            onSelect={setSelectedId}
            autoCollapseDepth={compact ? 2 : 6}
            autoCollapseSubtree={compact ? 12 : 80}
            filterCategories={filterCategories}
            focusExpensive={focusExpensive}
            search={search}
          />
        </div>

        <aside className="plan-detail">
          {selected ? (
            <>
              <div className="plan-detail-header">
                <span
                  className="operator-badge"
                  style={{
                    background: CATEGORY_META[selected.category].soft,
                    color: CATEGORY_META[selected.category].color,
                  }}
                >
                  {CATEGORY_META[selected.category].label}
                </span>
                <h3>{selected.label}</h3>
                {selected.isExpensive && (
                  <span className="plan-chip hot">
                    <AlertTriangle size={11} /> Expensive
                  </span>
                )}
              </div>

              <div className="plan-detail-section">
                <h4>Plain English</h4>
                <p>{selected.explanation}</p>
              </div>

              {selected.detail && (
                <div className="plan-detail-section">
                  <h4>Detail</h4>
                  <code>{selected.detail}</code>
                </div>
              )}

              <div className="plan-detail-grid">
                <div>
                  <span className="muted">Cost share</span>
                  <strong>{selected.costPercent.toFixed(1)}%</strong>
                </div>
                <div>
                  <span className="muted">Est. cost</span>
                  <strong>{selected.estimatedCost.toFixed(2)}</strong>
                </div>
                {selected.estimatedRows !== undefined && (
                  <div>
                    <span className="muted">Est. rows</span>
                    <strong>{selected.estimatedRows}</strong>
                  </div>
                )}
                {selected.actualTimeMs !== undefined && (
                  <div>
                    <span className="muted">Actual time</span>
                    <strong>{selected.actualTimeMs} ms</strong>
                  </div>
                )}
                <div>
                  <span className="muted">Subtree ops</span>
                  <strong>{selected.subtreeSize}</strong>
                </div>
                <div>
                  <span className="muted">Depth</span>
                  <strong>{selected.depth}</strong>
                </div>
              </div>

              {selected.children.length > 0 && (
                <div className="plan-detail-section">
                  <h4>Children ({selected.children.length})</h4>
                  <ul className="child-list">
                    {selected.children.map((c) => (
                      <li key={c.id}>
                        <button onClick={() => setSelectedId(c.id)}>
                          <span
                            className="plan-cat-dot"
                            style={{ background: CATEGORY_META[c.category].color }}
                          />
                          {c.label}
                          <span className="muted">{c.costPercent.toFixed(0)}%</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state" style={{ height: '100%' }}>
              <p>Select an operator to see a plain-English explanation.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
