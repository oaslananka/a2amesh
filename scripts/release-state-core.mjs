const RELEASE_PLEASE_ALLOWED_STATES = new Set(['published', 'release-pr-open', 'superseded']);

export function expectedDistTag(version) {
  const marker = version.indexOf('-');
  return marker === -1 ? 'latest' : version.slice(marker + 1).split('.')[0];
}

export function compareSemanticVersions(left, right) {
  const leftVersion = parseSemanticVersion(left);
  const rightVersion = parseSemanticVersion(right);
  if (!leftVersion || !rightVersion) return null;

  const coreComparison = compareNumericSegments(leftVersion.core, rightVersion.core);
  return coreComparison !== 0
    ? coreComparison
    : comparePrereleaseVersions(leftVersion.prerelease, rightVersion.prerelease);
}

function compareNumericSegments(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

function comparePrereleaseVersions(left, right) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return comparePrereleaseIdentifiers(left, right);
}

function comparePrereleaseIdentifiers(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = comparePrereleaseIdentifier(left[index], right[index]);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function comparePrereleaseIdentifier(left, right) {
  if (left === undefined) return -1;
  if (right === undefined) return 1;
  if (left === right) return 0;

  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return left.localeCompare(right);
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
  const supersessionValidation = validateSupersession(context, packages);
  blockers.push(...supersessionValidation.blockers);

  const hasStructuralDrift =
    context.drift.length > 0 ||
    sourceValidation.invalid ||
    releasePrValidation.invalid ||
    tagValidation.conflicts ||
    latestViolations.invalid ||
    supersessionValidation.invalid;
  if (hasStructuralDrift) {
    return releaseResult(context, {
      state: 'drifted',
      blockers,
      warnings,
      packages,
      publishAllowed: false,
    });
  }

  if (supersessionValidation.valid) {
    return releaseResult(context, {
      state: 'superseded',
      blockers: [],
      warnings: [...warnings, supersessionValidation.warning],
      packages,
      publishAllowed: false,
    });
  }

  const publication = summarizePublication(packages, tagValidation.publishedMatches);
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
  const checkedOutCommit = observation.checkedOutCommit ?? null;
  const canonicalCommit = observation.canonicalTag?.commit ?? null;
  const exactCommitMatch = Boolean(
    canonicalCommit && checkedOutCommit && canonicalCommit === checkedOutCommit,
  );
  return {
    checkedOutCommit,
    sourcePackages,
    sourceVersions,
    version,
    expectedTag: version ? `@a2amesh/runtime-v${version}` : null,
    expectedDistTag: version ? expectedDistTag(version) : null,
    releasePrs: Array.isArray(observation.releasePrs) ? observation.releasePrs : [],
    npmPackages: Array.isArray(observation.npmPackages) ? observation.npmPackages : [],
    canonicalTag: {
      name: observation.canonicalTag?.name ?? null,
      commit: canonicalCommit,
      isAncestorOfCheckout: observation.canonicalTag?.isAncestorOfCheckout ?? exactCommitMatch,
      sourceVersionMatches: observation.canonicalTag?.sourceVersionMatches ?? exactCommitMatch,
    },
    supersession: observation.supersession ?? null,
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
  if (version) {
    const comparison = compareSemanticVersions(versions[0], version);
    if (comparison == null || comparison <= 0) {
      return {
        blockers: [
          `Release Please PR #${pr.number} must advance the prepared version ${version}; found ${versions[0]}.`,
        ],
        warnings: [],
        invalid: true,
      };
    }
  }
  return {
    blockers: [],
    warnings: [`Release Please PR #${pr.number} proposes ${versions[0]} (${pr.url}).`],
    invalid: false,
  };
}

function validateCanonicalTag(context) {
  const commit = context.canonicalTag.commit;
  const nameMatches = Boolean(
    context.version && context.expectedTag && context.canonicalTag.name === context.expectedTag,
  );
  const sourceVersionMatches = Boolean(context.canonicalTag.sourceVersionMatches);
  const isAncestorOfCheckout = Boolean(context.canonicalTag.isAncestorOfCheckout);
  const matches = Boolean(
    nameMatches && commit && commit === context.checkedOutCommit && sourceVersionMatches,
  );
  const publishedMatches = Boolean(
    nameMatches && commit && isAncestorOfCheckout && sourceVersionMatches,
  );
  const missing = Boolean(context.version && commit == null);
  const blockers = [];

  if (context.version && commit != null) {
    if (!nameMatches) {
      blockers.push(
        `Canonical tag ${context.canonicalTag.name ?? '<missing>'} does not match expected tag ${context.expectedTag}.`,
      );
    }
    if (!isAncestorOfCheckout) {
      blockers.push(
        `Canonical tag ${context.expectedTag} resolves to ${commit}, which is not an ancestor of checked-out commit ${context.checkedOutCommit}.`,
      );
    }
    if (!sourceVersionMatches) {
      blockers.push(
        `Canonical tag ${context.expectedTag} at ${commit} does not prepare linked version ${context.version}.`,
      );
    }
  }

  return {
    matches,
    publishedMatches,
    missing,
    conflicts: blockers.length > 0,
    blockers,
  };
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

function validateSupersession(context, packages) {
  const supersession = context.supersession;
  if (!supersession) {
    return { present: false, valid: false, invalid: false, blockers: [], warning: '' };
  }

  const blockers = [];
  if (!context.version || supersession.version !== context.version) {
    blockers.push(
      `Release supersession version ${supersession.version ?? '<missing>'} does not match prepared version ${context.version ?? '<unknown>'}.`,
    );
  }
  const successorComparison = context.version
    ? compareSemanticVersions(supersession.successorVersion, context.version)
    : null;
  if (successorComparison == null || successorComparison <= 0) {
    blockers.push(
      `Superseded release ${context.version ?? '<unknown>'} must declare a successor that strictly advances the prepared version.`,
    );
  }
  if (context.canonicalTag.commit != null) {
    blockers.push(
      `Superseded release ${context.version ?? '<unknown>'} must not have a canonical tag.`,
    );
  }

  const npmEvidence = packages.filter(
    (item) =>
      item.versionExists ||
      item.expectedDistTagVersion === context.version ||
      item.latest === context.version,
  );
  if (npmEvidence.length > 0) {
    blockers.push(
      `Superseded release ${context.version ?? '<unknown>'} must not have npm publication evidence; found: ${npmEvidence.map((item) => item.name).join(', ')}.`,
    );
  }

  for (const pr of context.releasePrs) {
    const proposedVersions = uniqueValues(pr.versions ?? []);
    if (
      supersession.successorVersion &&
      proposedVersions.length === 1 &&
      proposedVersions[0] !== supersession.successorVersion
    ) {
      blockers.push(
        `Release Please PR #${pr.number} proposes ${proposedVersions[0]}, expected supersession successor ${supersession.successorVersion}.`,
      );
    }
  }

  return {
    present: true,
    valid: blockers.length === 0,
    invalid: blockers.length > 0,
    blockers,
    warning: formatSupersessionWarning(supersession),
  };
}

function formatSupersessionWarning(supersession) {
  const issueReference = supersession.issue ? ` (${supersession.issue})` : '';
  return `Release ${supersession.version} is explicitly superseded by ${supersession.successorVersion}${issueReference}.`;
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
    releasePlease: RELEASE_PLEASE_ALLOWED_STATES.has(state),
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
    nextSafeAction: nextSafeAction(
      state,
      gates,
      context.expectedTag,
      context.version,
      context.supersession,
    ),
  };
}

function nextSafeAction(state, gates, expectedTag, version, supersession) {
  if (state === 'superseded' && supersession?.successorVersion) {
    return `Advance Release Please to ${supersession.successorVersion}; do not tag or publish ${version}.`;
  }
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

function parseSemanticVersion(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : null,
  };
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}
