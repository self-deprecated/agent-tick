export function parseMetadata(values: string[] | undefined): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const value of values ?? []) {
    const separator = value.indexOf('=');
    if (separator <= 0) throw new Error(`invalid metadata: ${value}. Use key=value.`);
    const key = value.slice(0, separator).trim();
    const entry = value.slice(separator + 1).trim();
    if (!key) throw new Error(`invalid metadata: ${value}. Metadata key cannot be empty.`);
    metadata[key] = entry;
  }
  return metadata;
}

export function metadataEntriesFromRecord(record: Record<string, string> | undefined): string[] | undefined {
  return record ? Object.entries(record).map(([key, value]) => `${key}=${value}`) : undefined;
}

export function statusUpdateMetadata(options: { metadata?: string[] | undefined; importance?: string | undefined; notify?: boolean | undefined }): Record<string, string> | undefined {
  const metadata = parseMetadata(options.metadata);
  const importance = options.importance?.trim();
  if (importance && importance !== 'normal') metadata.agentTickImportance = importance;
  if (options.notify) metadata.agentTickNotify = 'true';
  return Object.keys(metadata).length ? metadata : undefined;
}
