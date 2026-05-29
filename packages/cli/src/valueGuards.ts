export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function requiredString(value: unknown, name: string): string {
  const text = optionalString(value);
  if (!text) throw new Error(`${name} is required`);
  return text;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function optionalStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) return undefined;
  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) if (typeof entry === 'string') record[key] = entry;
  return Object.keys(record).length ? record : undefined;
}

export function mcpErrorMessage(error: unknown): string {
  if (isPlainObject(error) && typeof error.message === 'string') return error.message;
  return String(error);
}
