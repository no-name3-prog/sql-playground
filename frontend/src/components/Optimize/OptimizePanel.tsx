import { useMemo, useState } from 'react';
import {
  Sparkles,
  AlertTriangle,
  Database,
  Wand2,
  ShieldAlert,
  Copy,
  Check,
  ArrowRight,
  Gauge,
} from 'lucide-react';
import type {
  OptimizationRecommendation,
  OptimizationReport,
  RecommendationSeverity,
  RecommendationType,
} from '../../types';
import { CATEGORY_META } from '../Analysis/categoryStyles';
import { useAppStore } from '../../stores/appStore';

interface Props {
  report: OptimizationReport;
  error?: string | null;
}

const TYPE_META: Record<
  RecommendationType,
  { label: string; icon: typeof Sparkles; color: string }
> = {
  'anti-pattern': { label: 'Anti-pattern', icon: ShieldAlert, color: '#ef4444' },
  index: { label: 'Index', icon: Database, color: '#0ea5e9' },
  rewrite: { label: 'Rewrite', icon: Wand2, color: '#a855f7' },
  warning: { label: 'Warning', icon: AlertTriangle, color: '#f59e0b' },
};

const SEV_COLOR: Record<RecommendationSeverity, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#94a3b8',
  info: '#64748b',
};

export function OptimizePanel({ report, error }: Props) {
  const applyRewrite = useAppStore((s) => s.applyRewrite);
  const [filter, setFilter] = useState<RecommendationType | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(
    report.recommendations[0]?.id ?? null
  );
  const [copied, setCopied] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === 'all') return report.recommendations;
    return report.recommendations.filter((r) => r.type === filter);
  }, [report.recommendations, filter]);

  const selected =
    filtered.find((r) => r.id === selectedId) ||
    filtered[0] ||
    report.recommendations.find((r) => r.id === selectedId) ||
    null;

  async function copyText(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  }

  const scoreColor =
    report.score >= 80 ? 'var(--success)' : report.score >= 55 ? 'var(--warning)' : 'var(--danger)';

  return (
    <div className="optimize-layout">
      {error && (
        <div className="analysis-banner warn">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      <div className="optimize-hero">
        <div className="optimize-hero-main">
          <div className="optimize-hero-title">
            <Sparkles size={16} />
            AI Optimization Assistant
            <span className="mode-pill">{report.mode === 'plan-rules+llm' ? 'Rules + LLM' : 'Plan-aware rules'}</span>
          </div>
          <p>{report.summary}</p>
        </div>
        <div className="optimize-score" style={{ borderColor: scoreColor }}>
          <Gauge size={16} style={{ color: scoreColor }} />
          <div>
            <div className="score-val" style={{ color: scoreColor }}>
              {report.score}
            </div>
            <div className="score-lbl">health</div>
          </div>
        </div>
        <div className="optimize-counts">
          <Count label="Anti-patterns" value={report.antiPatternCount} tone="danger" />
          <Count label="Indexes" value={report.indexSuggestionCount} tone="info" />
          <Count label="Rewrites" value={report.rewriteCount} tone="purple" />
          <Count label="Warnings" value={report.warningCount} tone="warn" />
        </div>
      </div>

      <div className="optimize-filters">
        {(['all', 'anti-pattern', 'index', 'rewrite', 'warning'] as const).map((t) => (
          <button
            key={t}
            className={`opt-filter ${filter === t ? 'active' : ''}`}
            onClick={() => setFilter(t)}
          >
            {t === 'all' ? 'All' : TYPE_META[t].label}
            <span>
              {t === 'all'
                ? report.recommendations.length
                : report.recommendations.filter((r) => r.type === t).length}
            </span>
          </button>
        ))}
      </div>

      {report.recommendations.length === 0 ? (
        <div className="empty-state" style={{ padding: 40 }}>
          <Sparkles size={28} strokeWidth={1.5} />
          <h3>No issues found in the plan</h3>
          <p>The assistant did not detect anti-patterns, costly scans, or rewrite opportunities for this execution plan.</p>
        </div>
      ) : (
        <div className="optimize-body">
          <div className="opt-list">
            {filtered.map((rec) => (
              <button
                key={rec.id}
                className={`opt-card ${selected?.id === rec.id ? 'active' : ''}`}
                onClick={() => setSelectedId(rec.id)}
              >
                <div className="opt-card-top">
                  <TypeBadge type={rec.type} />
                  <span
                    className="sev-badge"
                    style={{ color: SEV_COLOR[rec.severity], borderColor: SEV_COLOR[rec.severity] }}
                  >
                    {rec.severity}
                  </span>
                </div>
                <div className="opt-card-title">{rec.title}</div>
                <div className="opt-card-impact">
                  {rec.estimatedImprovement.speedupLabel || 'Impact'}:{' '}
                  {rec.estimatedImprovement.costReductionPercentMin}–
                  {rec.estimatedImprovement.costReductionPercentMax}% cost
                </div>
                <div className="opt-card-refs">
                  {rec.planReferences.slice(0, 3).map((ref) => (
                    <span key={ref.nodeId} className="plan-ref-chip">
                      <span
                        className="plan-cat-dot"
                        style={{ background: CATEGORY_META[ref.category]?.color || '#888' }}
                      />
                      {ref.label}
                      <em>{ref.costPercent.toFixed(0)}%</em>
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>

          <aside className="opt-detail">
            {selected ? (
              <RecommendationDetail
                rec={selected}
                copied={copied}
                onCopy={copyText}
                onApply={(sql) => applyRewrite(sql)}
              />
            ) : (
              <div className="empty-state">
                <p>Select a recommendation</p>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function Count({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className={`opt-count tone-${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function TypeBadge({ type }: { type: RecommendationType }) {
  const meta = TYPE_META[type];
  const Icon = meta.icon;
  return (
    <span className="type-badge" style={{ color: meta.color, background: `${meta.color}22` }}>
      <Icon size={11} />
      {meta.label}
    </span>
  );
}

function RecommendationDetail({
  rec,
  copied,
  onCopy,
  onApply,
}: {
  rec: OptimizationRecommendation;
  copied: string | null;
  onCopy: (text: string, id: string) => void;
  onApply: (sql: string) => void;
}) {
  return (
    <>
      <div className="opt-detail-header">
        <TypeBadge type={rec.type} />
        <span
          className="sev-badge"
          style={{ color: SEV_COLOR[rec.severity], borderColor: SEV_COLOR[rec.severity] }}
        >
          {rec.severity}
        </span>
      </div>
      <h3>{rec.title}</h3>

      <section className="opt-section">
        <h4>Problem (from plan)</h4>
        <p>{rec.problem}</p>
      </section>

      <section className="opt-section">
        <h4>Suggestion</h4>
        <p>{rec.suggestion}</p>
      </section>

      <section className="opt-section">
        <h4>Why this helps</h4>
        <p>{rec.why}</p>
      </section>

      <section className="opt-section impact-box">
        <h4>Estimated improvement</h4>
        <p className="impact-summary">{rec.estimatedImprovement.summary}</p>
        <div className="impact-bar-wrap">
          <div
            className="impact-bar"
            style={{
              width: `${Math.min(100, rec.estimatedImprovement.costReductionPercentMax)}%`,
            }}
          />
        </div>
        <div className="impact-meta">
          <span>
            {rec.estimatedImprovement.costReductionPercentMin}–
            {rec.estimatedImprovement.costReductionPercentMax}% plan cost
          </span>
          <span>confidence: {rec.estimatedImprovement.confidence}</span>
          {rec.estimatedImprovement.speedupLabel && (
            <span>{rec.estimatedImprovement.speedupLabel}</span>
          )}
        </div>
      </section>

      <section className="opt-section">
        <h4>Plan references</h4>
        <ul className="plan-ref-list">
          {rec.planReferences.map((ref) => (
            <li key={ref.nodeId}>
              <span
                className="plan-cat-dot"
                style={{ background: CATEGORY_META[ref.category]?.color || '#888' }}
              />
              <div>
                <strong>
                  {ref.label}
                  {ref.operator && ref.operator !== ref.label ? ` · ${ref.operator}` : ''}
                </strong>
                <div className="muted">
                  {ref.category} · {ref.costPercent.toFixed(1)}% cost · id {ref.nodeId}
                </div>
                {ref.detail && <div className="ref-detail">{ref.detail}</div>}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {rec.ddl && (
        <section className="opt-section">
          <div className="code-head">
            <h4>Suggested index DDL</h4>
            <button className="btn btn-ghost btn-sm" onClick={() => onCopy(rec.ddl!, rec.id + '-ddl')}>
              {copied === rec.id + '-ddl' ? <Check size={12} /> : <Copy size={12} />}
              Copy
            </button>
          </div>
          <pre className="opt-code">{rec.ddl}</pre>
        </section>
      )}

      {rec.sqlAfter && (
        <section className="opt-section">
          <div className="code-head">
            <h4>Suggested rewrite</h4>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => onCopy(rec.sqlAfter!, rec.id + '-sql')}
              >
                {copied === rec.id + '-sql' ? <Check size={12} /> : <Copy size={12} />}
                Copy
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => onApply(rec.sqlAfter!)}>
                <ArrowRight size={12} />
                Apply to editor
              </button>
            </div>
          </div>
          <pre className="opt-code">{rec.sqlAfter}</pre>
        </section>
      )}

      {rec.tags?.length > 0 && (
        <div className="opt-tags">
          {rec.tags.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      )}
    </>
  );
}
