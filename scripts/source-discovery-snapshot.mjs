function withoutGeneratedAt(document) {
  if (!document || typeof document !== "object") return document;
  const { generated_at: _generatedAt, ...rest } = document;
  return rest;
}
export function finalizeDiscoverySnapshot(previous, next, generatedAt = new Date().toISOString()) {
  const unchanged = previous
    && JSON.stringify(withoutGeneratedAt(previous)) === JSON.stringify(withoutGeneratedAt(next));

  return unchanged
    ? previous
    : { ...next, generated_at: generatedAt };
}
