import { Clock, Rows3, AlertTriangle, Table2, GitBranch, Sparkles } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { ResultTable } from './ResultTable';
import { AnalysisPanel } from '../Analysis/AnalysisPanel';
import { OptimizePanel } from '../Optimize/OptimizePanel';

export function ResultsPanel() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setResultsView = useAppStore((s) => s.setResultsView);
  const tab = tabs.find((t) => t.id === activeTabId);

  const result = tab?.result;
  const error = tab?.error;
  const analysis = tab?.analysis;
  const analysisError = tab?.analysisError;
  const optimization = tab?.optimization;
  const optimizationError = tab?.optimizationError;
  const isRunning = tab?.isRunning;
  const view = tab?.resultsView ?? 'results';

  const hasAnalysis = Boolean(analysis || analysisError);
  const hasOptimize = Boolean(optimization || optimizationError);

  return (
    <div className="results-pane">
      <div className="results-header">
        <div className="results-view-tabs">
          <button
            className={`results-view-tab ${view === 'results' ? 'active' : ''}`}
            onClick={() => setResultsView('results')}
          >
            <Table2 size={13} />
            Results
          </button>
          <button
            className={`results-view-tab ${view === 'analysis' ? 'active' : ''}`}
            onClick={() => setResultsView('analysis')}
            disabled={!hasAnalysis && !isRunning}
            title={analysis ? 'View execution plan analysis' : 'Run a query to generate analysis'}
          >
            <GitBranch size={13} />
            Analysis
            {analysis?.expensiveNodes?.length ? (
              <span className="analysis-badge">{analysis.expensiveNodes.length}</span>
            ) : null}
          </button>
          <button
            className={`results-view-tab ${view === 'optimize' ? 'active' : ''}`}
            onClick={() => setResultsView('optimize')}
            disabled={!hasOptimize && !isRunning}
            title={
              optimization
                ? 'AI optimization recommendations grounded in the plan'
                : 'Run a query to generate optimizations'
            }
          >
            <Sparkles size={13} />
            Optimize
            {optimization?.recommendations?.length ? (
              <span className="analysis-badge opt">
                {optimization.recommendations.length}
              </span>
            ) : null}
          </button>
        </div>

        {view === 'results' && result && !error && (
          <>
            <span className="results-stat ok">
              <Rows3 size={13} />
              <strong>{result.rowCount}</strong> rows
              {result.truncated && ' (truncated)'}
            </span>
            <span className="results-stat">
              <Clock size={13} />
              <strong>{result.executionTimeMs}</strong> ms
            </span>
          </>
        )}
        {view === 'analysis' && analysis && (
          <>
            <span className="results-stat">
              <strong>{analysis.totalNodes}</strong> operators
            </span>
            <span className="results-stat">
              depth <strong>{analysis.maxDepth}</strong>
            </span>
          </>
        )}
        {view === 'optimize' && optimization && (
          <>
            <span className="results-stat">
              score <strong>{optimization.score}</strong>/100
            </span>
            <span className="results-stat">
              <strong>{optimization.recommendations.length}</strong> tips
            </span>
          </>
        )}
        {error && (
          <span className="results-stat err">
            <AlertTriangle size={13} />
            <strong>Error</strong>
          </span>
        )}
        {isRunning && (
          <span className="results-stat">
            <div className="spinner" /> Running…
          </span>
        )}
      </div>
      <div className="results-body">
        {error && view === 'results' && <div className="error-panel">{error.message}</div>}

        {view === 'results' && !error && result && <ResultTable result={result} />}

        {view === 'results' && !error && !result && !isRunning && (
          <div className="empty-state">
            <Table2 size={28} strokeWidth={1.5} />
            <h3>No results yet</h3>
            <p>
              Write a SQL query and press <strong>Run</strong> or{' '}
              <kbd className="kbd">⌘</kbd>
              <kbd className="kbd">↵</kbd> to execute.
            </p>
          </div>
        )}

        {view === 'analysis' && analysis && (
          <AnalysisPanel analysis={analysis} analysisError={analysisError} />
        )}

        {view === 'analysis' && !analysis && analysisError && (
          <div className="error-panel">{analysisError}</div>
        )}

        {view === 'analysis' && !analysis && !analysisError && !isRunning && (
          <div className="empty-state">
            <GitBranch size={28} strokeWidth={1.5} />
            <h3>No plan yet</h3>
            <p>Execute a query to generate an execution plan and operator analysis.</p>
          </div>
        )}

        {view === 'optimize' && optimization && (
          <OptimizePanel report={optimization} error={optimizationError} />
        )}

        {view === 'optimize' && !optimization && optimizationError && (
          <div className="error-panel">{optimizationError}</div>
        )}

        {view === 'optimize' && !optimization && !optimizationError && !isRunning && (
          <div className="empty-state">
            <Sparkles size={28} strokeWidth={1.5} />
            <h3>No optimizations yet</h3>
            <p>
              Execute a query to run the plan-aware optimization assistant (indexes, rewrites,
              anti-patterns).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
