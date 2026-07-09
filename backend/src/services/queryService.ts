import { connectionService } from './connectionService.js';
import { historyService } from './historyService.js';
import { analyzeQuery, isExplainableSql } from '../analysis/analyzeService.js';
import { optimizeFromAnalysis } from '../optimization/optimizeService.js';
import type {
  AnalyzeQueryRequest,
  ExecuteQueryRequest,
  ExecuteQueryResponse,
  OptimizationReport,
  QueryAnalysis,
} from '../types/index.js';
import { DEFAULT_MAX_ROWS } from '../drivers/base.js';

class QueryService {
  async execute(req: ExecuteQueryRequest): Promise<ExecuteQueryResponse> {
    const { connectionId, sql, maxRows = DEFAULT_MAX_ROWS, analyze = true } = req;

    if (!sql?.trim()) {
      return {
        success: false,
        error: { message: 'SQL query is empty' },
      };
    }

    const config = connectionService.getRaw(connectionId);
    if (!config) {
      return {
        success: false,
        error: { message: `Connection not found: ${connectionId}` },
      };
    }

    try {
      const driver = await connectionService.getDriver(connectionId);
      const result = await driver.execute(sql, maxRows);

      let analysis: QueryAnalysis | undefined;
      let analysisError: string | undefined;
      let optimization: OptimizationReport | undefined;
      let optimizationError: string | undefined;

      if (analyze && isExplainableSql(sql)) {
        try {
          analysis = await analyzeQuery(driver, sql);
          try {
            optimization = await optimizeFromAnalysis(analysis);
          } catch (err) {
            optimizationError = err instanceof Error ? err.message : String(err);
          }
        } catch (err) {
          analysisError = err instanceof Error ? err.message : String(err);
        }
      }

      const history = historyService.add({
        connectionId,
        connectionName: config.name,
        engine: config.engine,
        sql,
        success: true,
        rowCount: result.rowCount,
        executionTimeMs: result.executionTimeMs,
      });

      return {
        success: true,
        result,
        historyId: history.id,
        analysis,
        analysisError,
        optimization,
        optimizationError,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const history = historyService.add({
        connectionId,
        connectionName: config.name,
        engine: config.engine,
        sql,
        success: false,
        errorMessage: message,
      });

      return {
        success: false,
        error: {
          message,
          code: (err as { code?: string }).code,
        },
        historyId: history.id,
      };
    }
  }

  async analyze(req: AnalyzeQueryRequest): Promise<{
    success: boolean;
    analysis?: QueryAnalysis;
    optimization?: OptimizationReport;
    error?: { message: string };
  }> {
    const { connectionId, sql } = req;
    if (!sql?.trim()) {
      return { success: false, error: { message: 'SQL query is empty' } };
    }

    try {
      const driver = await connectionService.getDriver(connectionId);
      const analysis = await analyzeQuery(driver, sql);
      const optimization = await optimizeFromAnalysis(analysis);
      return { success: true, analysis, optimization };
    } catch (err) {
      return {
        success: false,
        error: { message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  async optimize(req: AnalyzeQueryRequest): Promise<{
    success: boolean;
    optimization?: OptimizationReport;
    analysis?: QueryAnalysis;
    error?: { message: string };
  }> {
    const { connectionId, sql } = req;
    if (!sql?.trim()) {
      return { success: false, error: { message: 'SQL query is empty' } };
    }
    try {
      const driver = await connectionService.getDriver(connectionId);
      const analysis = await analyzeQuery(driver, sql);
      const optimization = await optimizeFromAnalysis(analysis);
      return { success: true, analysis, optimization };
    } catch (err) {
      return {
        success: false,
        error: { message: err instanceof Error ? err.message : String(err) },
      };
    }
  }
}

export const queryService = new QueryService();
