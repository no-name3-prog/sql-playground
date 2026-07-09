import type { SchemaGraphEdge, SchemaGraphNode } from '../../types';

export interface LaidOutNode extends SchemaGraphNode {
  x: number;
  y: number;
}

/** Simple force-directed layout (no external deps). */
export function layoutGraph(
  nodes: SchemaGraphNode[],
  edges: SchemaGraphEdge[],
  width: number,
  height: number
): LaidOutNode[] {
  if (!nodes.length) return [];

  const cx = width / 2;
  const cy = height / 2;
  const laid: LaidOutNode[] = nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    const r = Math.min(width, height) * 0.32;
    return {
      ...n,
      x: cx + r * Math.cos(angle) + (Math.random() - 0.5) * 8,
      y: cy + r * Math.sin(angle) + (Math.random() - 0.5) * 8,
    };
  });

  const byId = new Map(laid.map((n) => [n.id, n]));
  const iterations = Math.min(120, 40 + nodes.length * 4);

  for (let iter = 0; iter < iterations; iter++) {
    // repulsion
    for (let i = 0; i < laid.length; i++) {
      for (let j = i + 1; j < laid.length; j++) {
        const a = laid[i];
        const b = laid[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy) || 0.01;
        const force = 8000 / (dist * dist);
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        a.x -= dx;
        a.y -= dy;
        b.x += dx;
        b.y += dy;
      }
    }
    // attraction along edges
    for (const e of edges) {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const force = (dist - 160) * 0.02;
      dx = (dx / dist) * force;
      dy = (dy / dist) * force;
      a.x += dx;
      a.y += dy;
      b.x -= dx;
      b.y -= dy;
    }
    // soft center gravity + bounds
    for (const n of laid) {
      n.x += (cx - n.x) * 0.01;
      n.y += (cy - n.y) * 0.01;
      n.x = Math.max(70, Math.min(width - 70, n.x));
      n.y = Math.max(40, Math.min(height - 40, n.y));
    }
  }

  return laid;
}
