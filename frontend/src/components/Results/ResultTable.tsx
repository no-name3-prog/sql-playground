import type { QueryResult } from '../../types';

interface Props {
  result: QueryResult;
}

function formatCell(value: unknown): { text: string; isNull: boolean } {
  if (value === null || value === undefined) {
    return { text: 'NULL', isNull: true };
  }
  if (typeof value === 'object') {
    try {
      return { text: JSON.stringify(value), isNull: false };
    } catch {
      return { text: String(value), isNull: false };
    }
  }
  return { text: String(value), isNull: false };
}

export function ResultTable({ result }: Props) {
  const { columns, rows } = result;

  if (columns.length === 0 && rows.length === 0) {
    return (
      <div className="empty-state">
        <h3>Query returned no rows</h3>
        <p>The statement executed successfully but produced an empty result set.</p>
      </div>
    );
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th className="row-num-h">#</th>
          {columns.map((col) => (
            <th key={col.name}>
              {col.name}
              <span className="col-type">{col.type || '—'}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td className="row-num">{i + 1}</td>
            {columns.map((col) => {
              const { text, isNull } = formatCell(row[col.name]);
              return (
                <td key={col.name} className={isNull ? 'null' : undefined} title={text}>
                  {text}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
