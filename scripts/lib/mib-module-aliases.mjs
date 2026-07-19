function selectedRawEvidenceMatches(row, artifact, expectedModule) {
  return row?.selected_format === "raw"
    && row.activation_state === "candidate"
    && row.module === expectedModule
    && row.selected_artifact_id === artifact?.id
    && row.selected_source_id === artifact?.source_id
    && row.selected_sha256 === artifact?.artifact_sha256
    && artifact?.module === expectedModule
    && row.variants?.some((variant) => variant.format === "raw"
      && variant.artifact_id === artifact.id
      && variant.source_id === artifact.source_id
      && variant.sha256 === artifact.artifact_sha256);
}

function activeEvidenceMatches(row, activeModule, artifact, expectedModule) {
  return row?.selected_format === "active"
    && row.activation_state === "active"
    && row.module === expectedModule
    && row.selected_artifact_id === `active:${expectedModule}`
    && row.selected_source_id === artifact?.source_id
    && row.selected_sha256 === artifact?.artifact_sha256
    && artifact?.module === expectedModule
    && row.variants?.some((variant) => variant.format === "raw"
      && variant.artifact_id === artifact.id
      && variant.source_id === artifact.source_id
      && variant.sha256 === artifact.artifact_sha256)
    && activeModule?.id === expectedModule
    && activeModule.source_id === artifact.source_id
    && activeModule.artifact_sha256 === artifact.artifact_sha256
    && activeModule.source_sha256 === artifact.source_sha256
    && activeModule.activation_basis?.source_artifact_id === artifact.id
    && activeModule.variant_selection?.manifest_selected_artifact_id === artifact.id
    && activeModule.variant_selection?.variants?.some((variant) => variant.state === "promoted"
      && variant.format === "raw"
      && variant.artifact_id === artifact.id
      && variant.source_id === artifact.source_id
      && variant.sha256 === artifact.artifact_sha256);
}

export function validateMibModuleAliases(candidateSet, rawIntake, activeCatalog, aliasDocument) {
  const failures = [];
  const candidateByModule = new Map((candidateSet.modules ?? []).map((module) => [module.module, module]));
  const activeByModule = new Map((activeCatalog.modules ?? []).map((module) => [module.id, module]));
  const artifactById = new Map((rawIntake.artifacts ?? []).map((artifact) => [artifact.id, artifact]));
  const aliasByName = new Map();

  if (aliasDocument.schema_version !== 1) failures.push("MIB module alias schema version must be 1");
  for (const alias of aliasDocument.aliases ?? []) {
    if (aliasByName.has(alias.alias)) failures.push(`Duplicate MIB module alias ${alias.alias}`);
    aliasByName.set(alias.alias, alias);
    if (!alias.alias || !alias.canonical_module || alias.alias === alias.canonical_module) failures.push(`Invalid MIB module alias ${alias.alias}`);

    const importerRow = candidateByModule.get(alias.importer_module);
    const importerArtifact = artifactById.get(alias.importer_artifact_id);
    if (!selectedRawEvidenceMatches(importerRow, importerArtifact, alias.importer_module)) failures.push(`MIB module alias importer evidence drifted ${alias.alias}`);

    const canonicalRow = candidateByModule.get(alias.canonical_module);
    const canonicalArtifact = artifactById.get(alias.canonical_artifact_id);
    const activeModule = activeByModule.get(alias.canonical_module);
    const supportedTarget = canonicalRow?.selected_format === "raw" || canonicalRow?.selected_format === "active";
    if (!supportedTarget) failures.push(`MIB module alias target is neither selected raw nor evidence-bound active ${alias.alias}`);
    const canonicalMatches = selectedRawEvidenceMatches(canonicalRow, canonicalArtifact, alias.canonical_module)
      || activeEvidenceMatches(canonicalRow, activeModule, canonicalArtifact, alias.canonical_module);
    if (!canonicalMatches) failures.push(`MIB module alias canonical evidence drifted ${alias.alias}`);

    if (!importerArtifact || !canonicalArtifact) failures.push(`MIB module alias artifact evidence missing ${alias.alias}`);
    if (!alias.evidence?.trim()) failures.push(`MIB module alias evidence missing ${alias.alias}`);
  }
  for (const alias of aliasDocument.aliases ?? []) if (aliasByName.has(alias.canonical_module)) failures.push(`Chained MIB module alias is forbidden ${alias.alias}`);
  return failures;
}
