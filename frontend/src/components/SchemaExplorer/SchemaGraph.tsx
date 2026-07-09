import { useMemo, useRef, useState, useEffect } from 'react';
import type { SchemaGraphEdge, SchemaGraphNode } from '../../types';
import { layoutGraph } from './layout';

interface Props {
  nodes: SchemaGraphNode[];
  edges: SchemaGraphEdge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function SchemaGraph({ nodes, edges, selectedId, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 480 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(400, r.width), h: Math.max(320, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const laid = useMemo(
    () => layoutGraph(nodes, edges, size.w, size.h),
    [nodes, edges, size.w, size.h]
  );
  const byId = useMemo(() => new Map(laid.map((n) => [n.id, n])), [laid]);

  return (
    <div className="schema-graph" ref={wrapRef}>
      <svg width="100%" height="100%" viewBox={`0 0 ${size.w} ${size.h}`}>
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="22"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border-strong)" />
          </marker>
          <filter id="nodeShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.2" />
          </filter>
        </defs>

        {edges.map((e) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          return (
            <g key={e.id} className="schema-edge">
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="var(--border-strong)"
                strokeWidth={1.5}
                markerEnd="url(#arrow)"
              />
              <rect
                x={mx - 4}
                y={my - 8}
                width={Math.min(140, e.label.length * 5.5 + 8)}
                height={14}
                rx={3}
                fill="var(--bg-panel)"
                opacity={0.9}
              />
              <text x={mx} y={my + 2} className="edge-label" textAnchor="start">
                {e.label.length > 28 ? e.label.slice(0, 26) + '…' : e.label}
              </text>
            </g>
          );
        })}

        {laid.map((n) => {
          const selected = selectedId === n.id;
          const w = 132;
          const h = 48;
          return (
            <g
              key={n.id}
              className={`schema-node ${n.kind} ${selected ? 'selected' : ''}`}
              transform={`translate(${n.x - w / 2}, ${n.y - h / 2})`}
              onClick={() => onSelect(n.id)}
              style={{ cursor: 'pointer' }}
            >
              <rect
                width={w}
                height={h}
                rx={10}
                filter="url(#nodeShadow)"
                className="node-rect"
              />
              <text x={12} y={20} className="node-title">
                {n.label.length > 16 ? n.label.slice(0, 14) + '…' : n.label}
              </text>
              <text x={12} y={36} className="node-meta">
                {n.kind} · {n.columnCount} cols
                {n.rowCount != null ? ` · ${n.rowCount} rows` : ''}
              </text>
            </g>
          );
        })}
      </svg>
      {nodes.length === 0 && (
        <div className="empty-state" style={{ position: 'absolute', inset: 0 }}>
          <p>No tables or views to visualize.</p>
        </div>
      )}
    </div>
  );
}
