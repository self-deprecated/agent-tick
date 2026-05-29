export function parseDurationMs(value: string | number | undefined): number {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return 30 * 60_000;
  if (text === '0') return 0;
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(text);
  if (!match) throw new Error(`invalid duration: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2] ?? 'ms';
  const multiplier = unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : unit === 's' ? 1_000 : 1;
  return Math.round(amount * multiplier);
}
