import { promises as dns } from 'node:dns';
import { isIP, isIPv4 } from 'node:net';

/**
 * Checks if an IP address is in a private, loopback, or link-local range.
 * Supports IPv4 and basic IPv6 checks.
 */
export function isPrivateIP(ip: string): boolean {
  if (!isIP(ip)) return false;

  // IPv4 checks
  if (ip.includes('.') && isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4) return false;
    const [first = -1, second = -1] = parts;

    // Loopback: 127.0.0.0/8
    if (first === 127) return true;
    // 0.0.0.0/8
    if (first === 0) return true;
    // RFC1918: 10.0.0.0/8
    if (first === 10) return true;
    // RFC1918: 172.16.0.0/12
    if (first === 172 && second >= 16 && second <= 31) return true;
    // RFC1918: 192.168.0.0/16
    if (first === 192 && second === 168) return true;
    // Link-local: 169.254.0.0/16
    if (first === 169 && second === 254) return true;
    // Carrier-grade NAT: 100.64.0.0/10
    if (first === 100 && second >= 64 && second <= 127) return true;
    // Cloud provider metadata IP
    if (ip === '169.254.169.254') return true;

    return false;
  }

  // IPv6 checks
  const ipLower = ip.toLowerCase();
  const mappedIpv4 = ipv4FromMappedIpv6(ipLower);
  if (mappedIpv4) {
    return isPrivateIP(mappedIpv4);
  }

  // Loopback
  if (ipLower === '::1') return true;
  // Unspecified
  if (ipLower === '::') return true;
  // Link-local
  if (ipLower.startsWith('fe80:')) return true;
  // Unique local addresses
  if (ipLower.startsWith('fc') || ipLower.startsWith('fd')) return true;

  return false;
}

export interface SafeUrlOptions {
  allowLocalhost?: boolean;
  allowPrivateNetworks?: boolean;
  allowUnresolvedHostnames?: boolean;
  allowedHostnames?: string[];
  resolveHostname?: (hostname: string) => Promise<string[]>;
}

/**
 * Validates a URL to ensure it is safe for outbound requests (prevents SSRF).
 * Checks scheme, hostname, and resolves DNS to block private IPs.
 */
export async function validateSafeUrl(
  urlString: string,
  options: SafeUrlOptions = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch (err: unknown) {
    throw new Error('Invalid URL format', { cause: err });
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Unsupported URL protocol. Only http and https are allowed.');
  }

  const hostname = url.hostname;
  const allowPrivateNetworks = options.allowPrivateNetworks ?? false;
  const allowUnresolvedHostnames = options.allowUnresolvedHostnames ?? false;
  const isLocalHostname = hostname === 'localhost' || hostname === '::1' || hostname === '[::1]';
  const allowedHostnames = new Set(
    (options.allowedHostnames ?? []).map((value) => value.toLowerCase()),
  );

  if (allowedHostnames.size > 0 && !allowedHostnames.has(hostname.toLowerCase())) {
    throw new Error(`SSRF Prevention: Hostname is not in the outbound allowlist (${hostname})`);
  }

  if (options.allowLocalhost && isLocalHostname) {
    return url;
  }

  // Check if hostname is already an IP
  const hostnameWithoutBrackets = hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (isIP(hostnameWithoutBrackets)) {
    if (
      isPrivateIP(hostnameWithoutBrackets) &&
      !allowPrivateNetworks &&
      !(options.allowLocalhost && isLoopbackIP(hostnameWithoutBrackets))
    ) {
      throw new Error(`SSRF Prevention: Private IP addresses are not allowed (${hostname})`);
    }
    return url;
  }

  if (isLocalHostname && !options.allowLocalhost) {
    throw new Error('SSRF Prevention: Localhost is not allowed');
  }

  let addresses: string[];
  try {
    addresses = await (options.resolveHostname ?? dns.resolve)(hostname);
  } catch (err: unknown) {
    if (allowUnresolvedHostnames) {
      return url;
    }
    throw new Error('SSRF Prevention: Hostname could not be resolved', { cause: err });
  }

  for (const address of addresses) {
    if (
      isPrivateIP(address) &&
      !allowPrivateNetworks &&
      !(options.allowLocalhost && isLoopbackIP(address))
    ) {
      throw new Error(`SSRF Prevention: Hostname resolves to a private IP address (${address})`);
    }
  }

  return url;
}

function isLoopbackIP(ip: string): boolean {
  const normalized = ip.toLowerCase();
  const mappedIpv4 = ipv4FromMappedIpv6(normalized);
  if (mappedIpv4) {
    return isLoopbackIP(mappedIpv4);
  }

  if (normalized === '::1') {
    return true;
  }
  if (isIPv4(ip)) {
    return ip.startsWith('127.');
  }
  return false;
}

function ipv4FromMappedIpv6(ip: string): string | undefined {
  if (isIP(ip) !== 6) {
    return undefined;
  }

  const groups = parseIpv6Groups(ip);
  if (!groups) {
    return undefined;
  }

  const isMappedPrefix =
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff;

  if (!isMappedPrefix) {
    return undefined;
  }

  const high = groups[6];
  const low = groups[7];
  if (high === undefined || low === undefined) {
    return undefined;
  }

  return [Math.floor(high / 256), high % 256, Math.floor(low / 256), low % 256].join('.');
}

function parseIpv6Groups(ip: string): number[] | undefined {
  const normalized = normalizeIpv4Tail(ip);
  if (!normalized) {
    return undefined;
  }

  const compressedParts = normalized.split('::');
  if (compressedParts.length > 2) {
    return undefined;
  }

  const left = parseIpv6Side(compressedParts[0] ?? '');
  const right = compressedParts.length === 2 ? parseIpv6Side(compressedParts[1] ?? '') : [];
  if (!left || !right) {
    return undefined;
  }

  const missing = 8 - left.length - right.length;
  if (compressedParts.length === 1) {
    return missing === 0 ? [...left, ...right] : undefined;
  }
  if (missing < 1) {
    return undefined;
  }

  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}

function normalizeIpv4Tail(ip: string): string | undefined {
  const lastColon = ip.lastIndexOf(':');
  const possibleIpv4Tail = ip.slice(lastColon + 1);
  if (!possibleIpv4Tail.includes('.')) {
    return ip;
  }
  if (!isIPv4(possibleIpv4Tail)) {
    return undefined;
  }

  const [first = 0, second = 0, third = 0, fourth = 0] = possibleIpv4Tail.split('.').map(Number);
  const high = first * 256 + second;
  const low = third * 256 + fourth;
  return `${ip.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`;
}

function parseIpv6Side(side: string): number[] | undefined {
  if (side === '') {
    return [];
  }

  const groups = side.split(':');
  const parsedGroups: number[] = [];
  for (const group of groups) {
    if (!/^[\da-f]{1,4}$/.test(group)) {
      return undefined;
    }
    parsedGroups.push(Number.parseInt(group, 16));
  }
  return parsedGroups;
}
