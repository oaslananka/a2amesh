export interface LiveInteropManifest {
  schemaVersion: string;
  protocolVersion: '1.0';
  nodeVersion: string;
  pythonVersion: string;
  javascript: {
    package: '@a2a-js/sdk';
    version: string;
  };
  python: {
    package: 'a2a-sdk';
    version: string;
  };
}

export function validateLiveInteropManifest(value: unknown): string[];
export function loadLiveInteropManifest(root?: string): Promise<LiveInteropManifest>;
