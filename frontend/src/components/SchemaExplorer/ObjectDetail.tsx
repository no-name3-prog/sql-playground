import type { ObjectDetails } from '../../types';
import { ResultTable } from '../Results/ResultTable';

interface Props {
  details: ObjectDetails | null;
  loading: boolean;
  error: string | null;
  onInsertSelect: (name: string) => void;
}

export function ObjectDetail({ details, loading, error, onInsertSelect }: Props) {
  if (loading) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <div className="spinner" />
        <p>Loading object details…</p>
      </div>
    );
  }
  if (error) return <div className="error-panel">{error}</div>;
  if (!details) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <h3>Select a table or view</h3>
        <p>Click a node on the graph or an object in the list to see metadata, sample rows, and statistics.</p>
      </div>
    );
  }

  const s = details.statistics;

  return (
    <div className="object-detail">
      <div className="object-detail-head">
        <div>
          <span className={`kind-pill ${details.kind}`}>{details.kind}</span>
          <h2>{details.name}</h2>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => onInsertSelect(details.name)}>
          Insert SELECT
        </button>
      </div>

      <div className="stat-grid">
        <Stat label="Rows" value={s.rowCount ?? '—'} />
        <Stat label="Columns" value={s.columnCount} />
        <Stat label="Indexes" value={s.indexCount ?? 0} />
        <Stat label="Foreign keys" value={s.foreignKeyCount ?? 0} />
        <Stat label="Constraints" value={s.constraintCount ?? 0} />
      </div>

      <section>
        <h4>Columns</h4>
        <table className="meta-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Null</th>
              <th>PK</th>
              <th>Distinct</th>
              <th>Nulls</th>
              <th>Min / Max</th>
            </tr>
          </thead>
          <tbody>
            {details.columns.map((c) => {
              const st = s.columns.find((x) => x.name === c.name);
              return (
                <tr key={c.name}>
                  <td>
                    <code>{c.name}</code>
                  </td>
                  <td>{c.type}</td>
                  <td>{c.nullable ? 'YES' : 'NO'}</td>
                  <td>{c.isPrimaryKey ? '✓' : ''}</td>
                  <td>{st?.distinctCount ?? '—'}</td>
                  <td>{st?.nullCount ?? '—'}</td>
                  <td className="muted">
                    {st?.min != null || st?.max != null
                      ? `${fmt(st?.min)} … ${fmt(st?.max)}`
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {details.foreignKeys.length > 0 && (
        <section>
          <h4>Foreign keys</h4>
          <ul className="meta-list">
            {details.foreignKeys.map((fk) => (
              <li key={fk.id}>
                <code>
                  {fk.fromTable}({fk.fromColumns.join(', ')}) → {fk.toTable}(
                  {fk.toColumns.join(', ')})
                </code>
              </li>
            ))}
          </ul>
        </section>
      )}

      {details.indexes.length > 0 && (
        <section>
          <h4>Indexes</h4>
          <ul className="meta-list">
            {details.indexes.map((idx) => (
              <li key={idx.id}>
                <strong>{idx.name}</strong>
                <span className="muted">
                  {' '}
                  ({idx.columns.join(', ')})
                  {idx.unique ? ' · unique' : ''}
                  {idx.primary ? ' · primary' : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {details.constraints.length > 0 && (
        <section>
          <h4>Constraints</h4>
          <ul className="meta-list">
            {details.constraints.map((c) => (
              <li key={c.id}>
                <span className="kind-pill tiny">{c.type}</span> {c.name}
                {c.definition ? <div className="muted mono">{c.definition}</div> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {details.definition && (
        <section>
          <h4>Definition</h4>
          <pre className="opt-code">{details.definition}</pre>
        </section>
      )}

      <section>
        <h4>Sample rows {details.sample ? `(${details.sample.rowCount})` : ''}</h4>
        {details.sample && details.sample.rows.length > 0 ? (
          <div className="sample-wrap">
            <ResultTable result={details.sample} />
          </div>
        ) : (
          <p className="muted">No sample rows available.</p>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat-card">
      <span className="stat-val">{value}</span>
      <span className="stat-lbl">{label}</span>
    </div>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—';
  const s = String(v);
  return s.length > 24 ? s.slice(0, 22) + '…' : s;
}
