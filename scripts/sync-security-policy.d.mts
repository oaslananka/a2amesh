export function extractLinkedVersion(manifest: Record<string, unknown>): string;
export function renderSupportBlock(version: string): string;
export function syncPolicyText(policy: string, version: string): string;
export function validatePolicyFiles(input: {
  version: string;
  rootPolicy: string;
  githubPolicy: string;
}): string[];
