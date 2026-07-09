import type { QueryAnalysis, PlanNode } from '../types/analysis.js';
import type { OptimizationRecommendation } from '../types/optimization.js';

/**
 * Optional LLM enrichment. When XAI_API_KEY or OPENAI_API_KEY is set,
 * asks the model for additional rewrite ideas constrained to known plan node IDs.
 * Failures are silent — rules remain the source of truth.
 */
export async function enhanceWithLlm(
  analysis: QueryAnalysis,
  existing: OptimizationRecommendation[]
): Promise<OptimizationRecommendation[] | null> {
  const apiKey = process.env.XAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const baseUrl =
    process.env.XAI_API_KEY
      ? process.env.XAI_API_BASE || 'https://api.x.ai/v1'
      : process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
  const model =
    process.env.SQL_OPTIMIZER_MODEL ||
    (process.env.XAI_API_KEY ? 'grok-3' : 'gpt-4o-mini');

  const nodeIndex = flatten(analysis.root).map((n) => ({
    id: n.id,
    label: n.label,
    category: n.category,
    costPercent: n.costPercent,
    detail: n.detail,
    isExpensive: n.isExpensive,
  }));

  const prompt = {
    role: 'user' as const,
    content: `You are a SQL optimization assistant. You MUST ground every recommendation in the execution plan nodes provided. Do not invent node ids.

Engine: ${analysis.engine}
SQL:
${analysis.sql}

Plan summary: ${analysis.summary}

Plan nodes (JSON):
${JSON.stringify(nodeIndex, null, 2)}

Existing recommendations (do not duplicate titles):
${existing.map((r) => r.title).join('\n')}

Return ONLY a JSON array of 0-3 additional recommendations with shape:
[{
  "type": "rewrite"|"index"|"warning"|"anti-pattern",
  "severity": "critical"|"high"|"medium"|"low"|"info",
  "title": string,
  "problem": string,
  "suggestion": string,
  "why": string,
  "planNodeIds": string[],  // must be subset of provided ids
  "sqlAfter": string|null,
  "ddl": string|null,
  "costReductionPercentMin": number,
  "costReductionPercentMax": number,
  "confidence": "low"|"medium"|"high"
}]`,
  };

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You optimize SQL using execution plans. Never give advice without citing plan node ids.',
          },
          prompt,
        ],
      }),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = extractJsonArray(content);
    if (!parsed) return null;

    const byId = new Map(flatten(analysis.root).map((n) => [n.id, n]));
    const extras: OptimizationRecommendation[] = [];

    for (const item of parsed) {
      const ids = Array.isArray(item.planNodeIds) ? item.planNodeIds.map(String) : [];
      const refs = ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((n) => ({
          nodeId: (n as PlanNode).id,
          label: (n as PlanNode).label,
          category: (n as PlanNode).category,
          costPercent: (n as PlanNode).costPercent,
          detail: (n as PlanNode).detail,
          operator: (n as PlanNode).operator,
        }));
      if (!refs.length) continue;

      extras.push({
        id: crypto.randomUUID(),
        type: sanitizeType(item.type),
        severity: sanitizeSeverity(item.severity),
        title: String(item.title || 'LLM suggestion').slice(0, 200),
        problem: String(item.problem || ''),
        suggestion: String(item.suggestion || ''),
        why: String(item.why || 'Suggested based on execution plan operators.'),
        estimatedImprovement: {
          summary: `Estimated ${item.costReductionPercentMin ?? 5}–${item.costReductionPercentMax ?? 20}% plan cost reduction`,
          costReductionPercentMin: Number(item.costReductionPercentMin) || 5,
          costReductionPercentMax: Number(item.costReductionPercentMax) || 20,
          confidence: sanitizeConfidence(item.confidence),
        },
        planReferences: refs,
        sqlAfter: item.sqlAfter ? String(item.sqlAfter) : undefined,
        ddl: item.ddl ? String(item.ddl) : undefined,
        tags: ['llm', 'plan-grounded'],
      });
    }

    return extras.length ? [...existing, ...extras] : null;
  } catch {
    return null;
  }
}

function flatten(node: PlanNode): PlanNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

function extractJsonArray(text: string): Array<Record<string, unknown>> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end < 0) return null;
  try {
    const arr = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

function sanitizeType(
  t: unknown
): OptimizationRecommendation['type'] {
  const v = String(t || '');
  if (v === 'index' || v === 'rewrite' || v === 'warning' || v === 'anti-pattern') return v;
  return 'warning';
}


function sanitizeConfidence(
  c: unknown
): 'low' | 'medium' | 'high' {
  const v = String(c || '');
  if (v === 'low' || v === 'medium' || v === 'high') return v;
  return 'low';
}

function sanitizeSeverity(
  s: unknown
): OptimizationRecommendation['severity'] {
  const v = String(s || '');
  if (v === 'critical' || v === 'high' || v === 'medium' || v === 'low' || v === 'info') return v;
  return 'medium';
}
