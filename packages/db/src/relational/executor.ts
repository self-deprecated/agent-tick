import type { RelationalDialect, RelationalValue } from './dialect.js';

export interface RelationalQueryResult<Row> {
  rows: Row[];
  rowCount: number;
}

export interface RelationalExecutor {
  readonly dialect: RelationalDialect;
  query<Row = unknown>(sql: string, params?: RelationalValue[]): Promise<RelationalQueryResult<Row>>;
  transaction<T>(run: (executor: RelationalExecutor) => Promise<T>): Promise<T>;
  withAdvisoryTransactionLock<T>(lockName: string, run: (executor: RelationalExecutor) => Promise<T>): Promise<T>;
}

export async function one<Row>(executor: RelationalExecutor, sql: string, params: RelationalValue[] = []): Promise<Row | null> {
  const result = await executor.query<Row>(sql, params);
  return result.rows[0] ?? null;
}

export async function all<Row>(executor: RelationalExecutor, sql: string, params: RelationalValue[] = []): Promise<Row[]> {
  return (await executor.query<Row>(sql, params)).rows;
}
