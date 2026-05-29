export type RelationalDialectName = 'sqlite' | 'postgres';
export type RelationalValue = string | number | boolean | null | Buffer;

export interface ConflictTarget {
  columns?: string[];
  constraint?: string;
}

export interface RelationalDialect {
  name: RelationalDialectName;
  supportsReturning: boolean;
  placeholder(position: number): string;
  placeholders(count: number, startAt?: number): string;
  insertInto(table: string, columns: string[]): string;
  onConflictDoNothing(target?: ConflictTarget): string;
  returning(columns: string[]): string;
  encodeJSON(value: unknown): string;
  decodeJSON<T>(value: string | null | undefined, fallback: T): T;
  encodeBoolean(value: boolean): number | boolean;
  decodeBoolean(value: number | boolean | null | undefined): boolean;
  timestampBefore(column: string, placeholder: string): string;
  limitOffset(limitPlaceholder: string, offsetPlaceholder?: string): string;
  advisoryLockId(name: string): number;
}

export function commaSeparated(values: string[]): string {
  return values.join(', ');
}

export function stableAdvisoryLockId(name: string): number {
  let hash = 0x61746963;
  for (const char of name) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash | 0;
}
