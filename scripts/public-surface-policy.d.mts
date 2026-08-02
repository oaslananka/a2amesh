export type PublicSurfaceStatus = 'alpha' | 'beta' | 'rc' | 'stable';
export type PublicSurfaceTarget = 'current' | 'stable';

export interface PublicSurfacePackageJson {
  name?: string;
  version: string;
  exports?: Readonly<Record<string, unknown>>;
  bin?: string | Readonly<Record<string, string>>;
}

export interface PublicSurfaceInventory {
  status: PublicSurfaceStatus;
  exports: readonly string[];
  bins: readonly string[];
}

export interface PublicSurfacePolicyInput {
  packagePath: string;
  inventoryPath: string;
  packageJson: PublicSurfacePackageJson;
  inventory: PublicSurfaceInventory;
  target?: PublicSurfaceTarget;
}

export function releaseChannelForVersion(version: string): PublicSurfaceStatus | undefined;
export function validatePublicSurfacePolicy(input: PublicSurfacePolicyInput): string[];
