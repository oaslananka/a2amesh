const PUBLISHED_STATES = new Set(['published', 'release-pr-open']);

export function expectedDistTag(version) {
  const marker = version.indexOf('-');
  return marker === -1 ? 'latest' : version.slice(marker + 1).split('.')[0];
}

export function evaluateReleaseState(observation) {
  const blockers = [];
  const warnings = [];
  const errors = Array.isArray(observation.errors) ? observation.errors.filter(Boolean) : [];
  const drift = Array.isArray(observation.drift) ? observation.drift.filter(Boolean) : [];
  blockers.push(...drift);
  const sourcePackages = Array.isArray(observation.sourcePackages)
    ? observation.sourcePackages
    : [];
  const sourceVersions = [...new Set(sourcePackages.map((item) => item.version).filter(Boolean))];
  const version = sourceVersions.length === 1 ? sourceVersions[0] : null;
  const expectedTag = version ? `@a2amesh/runtime-v${version}` : null;
  const distTag = version ? expectedDistTag(version) : null;

  if (errors.length > 0) {
    return result({
      state: 'unavailable',
      version,
      expectedTag,
      expectedDistTag: distTag,
      blockers: errors,
      warnings,
      packages: [],
      publishAllowed: false,
    });
  }

  if (sourcePackages.length === 0) {
    blockers.push('No release-tracked source packages were observed.');
  }
  if (sourceVersions.length !== 1) {
    blockers.push(
      `Linked public package versions must agree; found: ${sourceVersions.join(', ') || '<none>'}.`,
    );
  }

  const releasePrs = Array.isArray(observation.releasePrs) ? observation.releasePrs : [];
  if (releasePrs.length > 1) {
    blockers.push(`Multiple Release Please pull requests are open (${releasePrs.length}).`);
  }
  for (const pr of releasePrs) {
    const versions = [...new Set((pr.versions ?? []).filter(Boolean))];
    if (versions.length !== 1) {
      blockers.push(
        `Release Please PR #${pr.number} must propose one linked version; found: ${versions.join(', ') || '<none>'}.`,
      );
    } else if (version && versions[0] === version) {
      blockers.push(
        `Release Please PR #${pr.number} does not advance the prepared version ${version}.`,
      );
    } else {
      warnings.push(`Release Please PR #${pr.number} proposes ${versions[0]} (${pr.url}).`);
    }
  }

  const canonicalTag = observation.canonicalTag ?? { name: expectedTag, commit: null };
  const tagMatches = Boolean(
    version &&
    expectedTag &&
    canonicalTag.name === expectedTag &&
    canonicalTag.commit === observation.checkedOutCommit,
  );
  const tagMissing = version && canonicalTag.commit == null;
  const tagConflicts = Boolean(
    version && canonicalTag.commit != null && canonicalTag.commit !== observation.checkedOutCommit,
  );

  if (tagConflicts) {
    blockers.push(
      `Canonical tag ${expectedTag} resolves to ${canonicalTag.commit}, not checked-out commit ${observation.checkedOutCommit}.`,
    );
  }

  const npmByName = new Map(
    (Array.isArray(observation.npmPackages) ? observation.npmPackages : []).map((item) => [
      item.name,
      item,
    ]),
  );
  const missingObservations = sourcePackages.filter((item) => !npmByName.has(item.name));
  if (missingObservations.length > 0) {
    return result({
      state: 'unavailable',
      version,
      expectedTag,
      expectedDistTag: distTag,
      blockers: [
        ...blockers,
        ...missingObservations.map((item) => `Missing npm observation for ${item.name}.`),
      ],
      warnings,
      packages: [],
      publishAllowed: false,
    });
  }

  const packages = sourcePackages.map((source) => {
    const npmPackage = npmByName.get(source.name);
    const versionExists = Boolean(npmPackage?.versionExists);
    const actualExpectedTag = distTag ? (npmPackage?.distTags?.[distTag] ?? null) : null;
    const expectedTagMatches = Boolean(version && actualExpectedTag === version);
    const latest = npmPackage?.distTags?.latest ?? null;
    return {
      name: source.name,
      path: source.path,
      version: source.version,
      versionExists,
      expectedDistTag: distTag,
      expectedDistTagVersion: actualExpectedTag,
      expectedDistTagMatches: expectedTagMatches,
      latest,
      complete: versionExists && expectedTagMatches,
    };
  });

  const prereleaseLatestViolations =
    version && distTag !== 'latest' ? packages.filter((item) => item.latest === version) : [];
  if (prereleaseLatestViolations.length > 0) {
    blockers.push(
      ...prereleaseLatestViolations.map(
        (item) => `${item.name}: latest must not point to prerelease ${version}.`,
      ),
    );
  }

  const hasStructuralDrift =
    drift.length > 0 ||
    sourceVersions.length !== 1 ||
    sourcePackages.length === 0 ||
    releasePrs.length > 1 ||
    releasePrs.some((pr) => new Set((pr.versions ?? []).filter(Boolean)).size !== 1) ||
    releasePrs.some((pr) => version && new Set((pr.versions ?? []).filter(Boolean)).has(version)) ||
    tagConflicts ||
    prereleaseLatestViolations.length > 0;

  if (hasStructuralDrift) {
    return result({
      state: 'drifted',
      version,
      expectedTag,
      expectedDistTag: distTag,
      blockers,
      warnings,
      packages,
      publishAllowed: false,
    });
  }

  const exactVersionCount = packages.filter((item) => item.versionExists).length;
  const completeCount = packages.filter((item) => item.complete).length;
  const fullyPublished = tagMatches && completeCount === packages.length;

  if (fullyPublished) {
    const state = releasePrs.length === 1 ? 'release-pr-open' : 'published';
    return result({
      state,
      version,
      expectedTag,
      expectedDistTag: distTag,
      blockers: [],
      warnings,
      packages,
      publishAllowed: false,
    });
  }

  if (tagMissing) {
    blockers.push(
      `Missing canonical tag ${expectedTag} for checked-out commit ${observation.checkedOutCommit}.`,
    );
  }
  for (const item of packages) {
    if (!item.versionExists) blockers.push(`${item.name}@${version} is missing from npm.`);
    if (item.versionExists && !item.expectedDistTagMatches) {
      blockers.push(
        `${item.name}: ${distTag} points to ${item.expectedDistTagVersion ?? '<missing>'}, expected ${version}.`,
      );
    }
  }

  const anyPublicationEvidence = exactVersionCount > 0 || completeCount > 0;
  const state = anyPublicationEvidence ? 'partial-publication' : 'prepared-unpublished';
  const resumablePartial =
    state === 'partial-publication' &&
    exactVersionCount < packages.length &&
    packages.every((item) => !item.versionExists || item.expectedDistTagMatches);
  const publishAllowed = tagMatches && (state === 'prepared-unpublished' || resumablePartial);

  return result({
    state,
    version,
    expectedTag,
    expectedDistTag: distTag,
    blockers,
    warnings,
    packages,
    publishAllowed,
  });
}

function result({
  state,
  version,
  expectedTag,
  expectedDistTag,
  blockers,
  warnings,
  packages,
  publishAllowed,
}) {
  const gates = {
    releasePlease: PUBLISHED_STATES.has(state),
    publish: Boolean(publishAllowed),
  };
  return {
    state,
    version,
    expectedTag,
    expectedDistTag,
    blockers,
    warnings,
    gates,
    packages,
    nextSafeAction: nextSafeAction(state, gates, expectedTag),
  };
}

function nextSafeAction(state, gates, expectedTag) {
  if (gates.publish) return `Dispatch the protected Publish workflow for ${expectedTag}.`;
  if (gates.releasePlease)
    return 'Release Please may create or update the next linked-version pull request.';
  if (state === 'prepared-unpublished' && expectedTag) {
    return `Create ${expectedTag} on the verified release commit before publishing.`;
  }
  if (state === 'partial-publication')
    return 'Reconcile the partial npm publication before continuing.';
  if (state === 'unavailable') return 'Restore reliable GitHub and npm observations, then retry.';
  return 'Resolve release-state blockers before continuing.';
}
