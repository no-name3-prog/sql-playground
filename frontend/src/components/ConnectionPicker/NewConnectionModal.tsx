import { useState } from 'react';
import { X } from 'lucide-react';
import type { CreateConnectionInput, DatabaseEngine } from '../../types';

interface Props {
  onClose: () => void;
  onCreate: (input: CreateConnectionInput) => Promise<void>;
}

const ENGINES: { id: DatabaseEngine; label: string }[] = [
  { id: 'sqlite', label: 'SQLite' },
  { id: 'duckdb', label: 'DuckDB' },
  { id: 'postgresql', label: 'PostgreSQL' },
  { id: 'mysql', label: 'MySQL' },
];

export function NewConnectionModal({ onClose, onCreate }: Props) {
  const [engine, setEngine] = useState<DatabaseEngine>('postgresql');
  const [name, setName] = useState('');
  const [filename, setFilename] = useState('');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('5432');
  const [database, setDatabase] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [ssl, setSsl] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFile = engine === 'sqlite' || engine === 'duckdb';

  function onEngineChange(e: DatabaseEngine) {
    setEngine(e);
    if (e === 'postgresql') setPort('5432');
    if (e === 'mysql') setPort('3306');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const input: CreateConnectionInput = {
        name: name || `${engine} connection`,
        engine,
        ...(isFile
          ? { filename }
          : {
              host,
              port: Number(port) || undefined,
              database,
              user,
              password,
              ssl,
            }),
      };
      await onCreate(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add connection</h2>
          <button className="btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="field">
              <label>Engine</label>
              <select
                className="select"
                value={engine}
                onChange={(e) => onEngineChange(e.target.value as DatabaseEngine)}
              >
                {ENGINES.map((eng) => (
                  <option key={eng.id} value={eng.id}>
                    {eng.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Display name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My database"
              />
            </div>

            {isFile ? (
              <div className="field">
                <label>File path</label>
                <input
                  className="input"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="/path/to/database.db"
                  required
                />
                <span className="field-hint">
                  Absolute path to a {engine === 'sqlite' ? '.db' : '.duckdb'} file on the
                  server.
                </span>
              </div>
            ) : (
              <>
                <div className="field-row">
                  <div className="field">
                    <label>Host</label>
                    <input
                      className="input"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Port</label>
                    <input
                      className="input"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                    />
                  </div>
                </div>
                <div className="field">
                  <label>Database</label>
                  <input
                    className="input"
                    value={database}
                    onChange={(e) => setDatabase(e.target.value)}
                    placeholder="database name"
                    required={engine === 'mysql'}
                  />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>User</label>
                    <input
                      className="input"
                      value={user}
                      onChange={(e) => setUser(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Password</label>
                    <input
                      className="input"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                </div>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={ssl}
                    onChange={(e) => setSsl(e.target.checked)}
                  />
                  Use SSL
                </label>
              </>
            )}

            {error && <div className="error-panel" style={{ margin: 0 }}>{error}</div>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
