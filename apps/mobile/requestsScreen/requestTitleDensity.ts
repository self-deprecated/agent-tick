export function usesCompactRequestTitle(title: string) {
  const normalized = title.replace(/\s+/gu, " ").trim();
  if (!normalized) return false;
  const wordCount = normalized.split(" ").length;
  return normalized.length > 110 || wordCount > 14;
}

export function usesDenseRequestTitle(title: string) {
  const normalized = title.replace(/\s+/gu, " ").trim();
  if (!normalized) return false;
  const wordCount = normalized.split(" ").length;
  return normalized.length > 220 || wordCount > 28;
}
