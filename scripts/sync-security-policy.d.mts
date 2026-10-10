export function extractLinkedVersion(manifest: Record<string, unknown>): string;
export function publishedSupportVersion(
  manifest: Record<string, unknown>,
  evidence: {
    release?: {
      npm?: { package?: string; latest?: string; alpha?: string };
      latest_canonical_tag?: { name?: string };
    };
  },
): string;
export function renderSupportBlock(version: string): string;
export function syncPolicyText(policy: string, version: string): string;
export function validatePolicyFiles(input: {
  version: string;
  rootPolicy: string;
  githubPolicy: string;
}): string[];
