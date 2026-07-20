const PUBLISHED_STATES = new Set(['published', 'release-pr-open']);

export function expectedDistTag(version) {
  const marker = version.indexOf('-');
  return marker === -1 ? 'latest' : version.slice(marker + 1).split('.')[0];
}

export function evaluateReleaseState(observation) {
  const context = normalizeObservation(observation);
  if (context.errors.length > 0) return unavailableResult(context, context.errors);

  const sourceValidation = validateSourcePackages(context);
  const releasePrValidation = validateReleasePullRequests(context.releasePrs, context.version);
  const tagValidation = validateCanonicalTag(context);
  const blockers = [
    ...context.drift,
    ...sourceValidation.blockers,
    ...releasePrValidation.blockers,
    ...tagValidation.blockers,
  ];
  const warnings = releasePrValidation.warnings;
  const npmIndex = new Map(context.npmPackages.map((item) => [item.name, item]));
  const missingNpmObservations = context.sourcePackages.filter((item) => !npmIndex.has(item.name));
  if (missingNpmObservations.length > 0) {
    return unavailableResult(
      context,
      [
        ...blockers,
        ...missingNpmObservations.map((item) => `Missing npm observation for ${item.name}.`),
      ],
      warnings,
    );
  }

  const packages = buildPackageResults(context, npmIndex);
  const latestViolations = findPrereleaseLatestViolations(context, packages);
  blockers.push(...latestViolations.blockers);

  const hasStructuralDrift =
    context.drift.length > 0 ||
    sourceValidation.invalid ||
    releasePrValidation.invalid ||
    tagValidation.conflicts ||
    latestViolations.invalid;
  if (hasStructuralDrift) {
    return releaseResult(context, {
      state: 'drifted',
      blockers,
      warnings,
      packages,
      publishAllowed: false,
    });
  }

  const publication = summarizePublication(packages, tagValidation.matches);
  if (publication.fullyPublished) {
    return releaseResult(context, {
      state: context.releasePrs.length === 1 ? 'release-pr-open' : 'published',
      blockers: [],
      warnings,
      packages,
      publishAllowed: false,
    });
  }

  appendUnpublishedBlockers(context, tagValidation, packages, blockers);
  const state = publication.hasEvidence ? 'partial-publication' : 'prepared-unpublished';
  const publishAllowed =
    tagValidation.matches &&
    (state === 'prepared-unpublished' || isResumablePartial(packages, publication));

  return releaseResult(context, {
    state,
    blockers,
    warnings,
    packages,
    publishAllowed,
  });
}

function normalizeObservation(observation) {
  const sourcePackages = Array.isArray(observation.sourcePackages)
    ? observation.sourcePackages
    : [];
  const sourceVersions = uniqueValues(sourcePackages.map((item) => item.version));
  const version = sourceVersions.length === 1 ? sourceVersions[0] : null;
  return {
    checkedOutCommit: observation.checkedOutCommit ?? null,
    sourcePackages,
    sourceVersions,
    version,
    expectedTag: version ? `@a2amesh/runtime-v${version}` : null,
    expectedDistTag: version ? expectedDistTag(version) : null,
    releasePrs: Array.isArray(observation.releasePrs) ? observation.releasePrs : [],
    npmPackages: Array.isArray(observation.npmPackages) ? observation.npmPackages : [],
    canonicalTag: observation.canonicalTag ?? { name: null, commit: null },
    errors: Array.isArray(observation.errors) ? observation.errors.filter(Boolean) : [],
    drift: Array.isArray(observation.drift) ? observation.drift.filter(Boolean) : [],
  };
}

function validateSourcePackages(context) {
  const blockers = [];
  if (context.sourcePackages.length === 0) {
    blockers.push('No release-tracked source packages were observed.');
  }
  if (context.sourceVersions.length !== 1) {
    blockers.push(
      `Linked public package versions must agree; found: ${context.sourceVersions.join(', ') || '<none>'}.`,
    );
  }
  return {
    blockers,
    invalid: context.sourcePackages.length === 0 || context.sourceVersions.length !== 1,
  };
}

function validateReleasePullRequests(releasePrs, version) {
  const blockers = [];
  const warnings = [];
  let invalid = releasePrs.length > 1;
  if (releasePrs.length > 1) {
    blockers.push(`Multiple Release Please pull requests are open (${releasePrs.length}).`);
  }
  for (const pr of releasePrs) {
    const versions = uniqueValues(pr.versions ?? []);
    const validation = validateReleasePullRequest(pr, versions, version);
    blockers.push(...validation.blockers);
    warnings.push(...validation.warnings);
    invalid ||= validation.invalid;
  }
  return { blockers, warnings, invalid };
}

function validateReleasePullRequest(pr, versions, version) {
  if (versions.length !== 1) {
    return {
      blockers: [
        `Release Please PR #${pr.number} must propose one linked version; found: ${versions.join(', ') || '<none>'}.`,
      ],
      warnings: [],
      invalid: true,
    };
  }
  if (version && versions[0] === version) {
    return {
      blockers: [
        `Release Please PR #${pr.number} does not advance the prepared version ${version}.`,
      ],
      warnings: [],
      invalid: true,
    };
  }
  return {
    blockers: [],
    warnings: [`Release Please PR #${pr.number} proposes ${versions[0]} (${pr.url}).`],
    invalid: false,
  };
}

function validateCanonicalTag(context) {
  const commit = context.canonicalTag.commit;
  const matches = Boolean(
    context.version &&
    context.expectedTag &&
    context.canonicalTag.name === context.expectedTag &&
    commit === context.checkedOutCommit,
  );
  const missing = Boolean(context.version && commit == null);
  const conflicts = Boolean(
    context.version && commit != null && commit !== context.checkedOutCommit,
  );
  const blockers = conflicts
    ? [
        `Canonical tag ${context.expectedTag} resolves to ${commit}, not checked-out commit ${context.checkedOutCommit}.`,
      ]
    : [];
  return { matches, missing, conflicts, blockers };
}

function buildPackageResults(context, npmIndex) {
  return context.sourcePackages.map((source) => {
    const npmPackage = npmIndex.get(source.name);
    const versionExists = Boolean(npmPackage?.versionExists);
    const actualExpectedTag = context.expectedDistTag
      ? (npmPackage?.distTags?.[context.expectedDistTag] ?? null)
      : null;
    const expectedTagMatches = Boolean(context.version && actualExpectedTag === context.version);
    return {
      name: source.name,
      path: source.path,
      version: source.version,
      versionExists,
      expectedDistTag: context.expectedDistTag,
      expectedDistTagVersion: actualExpectedTag,
      expectedDistTagMatches: expectedTagMatches,
      latest: npmPackage?.distTags?.latest ?? null,
      complete: versionExists && expectedTagMatches,
    };
  });
}

function findPrereleaseLatestViolations(context, packages) {
  if (!context.version || context.expectedDistTag === 'latest') {
    return { blockers: [], invalid: false };
  }
  const violations = packages.filter((item) => item.latest === context.version);
  return {
    blockers: violations.map(
      (item) => `${item.name}: latest must not point to prerelease ${context.version}.`,
    ),
    invalid: violations.length > 0,
  };
}

function summarizePublication(packages, tagMatches) {
  const exactVersionCount = packages.filter((item) => item.versionExists).length;
  const completeCount = packages.filter((item) => item.complete).length;
  return {
    exactVersionCount,
    completeCount,
    fullyPublished: tagMatches && completeCount === packages.length,
    hasEvidence: exactVersionCount > 0 || completeCount > 0,
  };
}

function appendUnpublishedBlockers(context, tagValidation, packages, blockers) {
  if (tagValidation.missing) {
    blockers.push(
      `Missing canonical tag ${context.expectedTag} for checked-out commit ${context.checkedOutCommit}.`,
    );
  }
  for (const item of packages) {
    appendPackageBlockers(context, item, blockers);
  }
}

function appendPackageBlockers(context, item, blockers) {
  if (!item.versionExists) {
    blockers.push(`${item.name}@${context.version} is missing from npm.`);
    return;
  }
  if (!item.expectedDistTagMatches) {
    blockers.push(
      `${item.name}: ${context.expectedDistTag} points to ${item.expectedDistTagVersion ?? '<missing>'}, expected ${context.version}.`,
    );
  }
}

function isResumablePartial(packages, publication) {
  return (
    publication.exactVersionCount < packages.length &&
    packages.every((item) => !item.versionExists || item.expectedDistTagMatches)
  );
}

function unavailableResult(context, blockers, warnings = []) {
  return releaseResult(context, {
    state: 'unavailable',
    blockers,
    warnings,
    packages: [],
    publishAllowed: false,
  });
}

function releaseResult(context, { state, blockers, warnings, packages, publishAllowed }) {
  const gates = {
    releasePlease: PUBLISHED_STATES.has(state),
    publish: Boolean(publishAllowed),
  };
  return {
    state,
    version: context.version,
    expectedTag: context.expectedTag,
    expectedDistTag: context.expectedDistTag,
    blockers,
    warnings,
    gates,
    packages,
    nextSafeAction: nextSafeAction(state, gates, context.expectedTag),
  };
}

function nextSafeAction(state, gates, expectedTag) {
  if (gates.publish) return `Dispatch the protected Publish workflow for ${expectedTag}.`;
  if (gates.releasePlease) {
    return 'Release Please may create or update the next linked-version pull request.';
  }
  if (state === 'prepared-unpublished' && expectedTag) {
    return `Create ${expectedTag} on the verified release commit before publishing.`;
  }
  if (state === 'partial-publication') {
    return 'Reconcile the partial npm publication before continuing.';
  }
  if (state === 'unavailable') return 'Restore reliable GitHub and npm observations, then retry.';
  return 'Resolve release-state blockers before continuing.';
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}
