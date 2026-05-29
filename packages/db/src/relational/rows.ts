export function encodeJSON(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function decodeJSON<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  return JSON.parse(value) as T;
}

export function requireSingleRow<Row>(rows: Row[], description: string): Row {
  const row = rows[0];
  if (!row) throw new Error(`${description} not found`);
  return row;
}

export function firstRow<Row>(rows: Row[]): Row | null {
  return rows[0] ?? null;
}
