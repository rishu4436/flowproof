export class PolicyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PolicyError";
  }
}

const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data",
]);

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export function parseAllowlist(entries: string[]): URL[] {
  const urls: URL[] = [];
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new PolicyError("invalid_allowlist", `Allowlist entry is not a URL: ${trimmed}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new PolicyError("invalid_allowlist", `Allowlist scheme is not permitted: ${url.protocol}`);
    }
    urls.push(url);
  }
  return urls;
}

export function isIpLiteral(host: string): boolean {
  return isIpv4(host) || isIpv6(unwrapIpv6(host));
}

export function isBlockedAddress(address: string): boolean {
  const host = normalizeIp(address);
  if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  if (host === "::" || host === "0:0:0:0:0:0:0:0") return true;
  if (!isIpv4(host)) return false;
  const [a, b] = host.split(".").map(Number);
  if (a === undefined || b === undefined) return true;
  if (a === 10 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function isLoopbackAddress(address: string): boolean {
  const host = normalizeIp(address);
  if (host === "::1") return true;
  if (!isIpv4(host)) return false;
  return host.startsWith("127.");
}

export function isMetadataAddress(address: string): boolean {
  const host = normalizeIp(address);
  return host === "169.254.169.254" || host === "fd00:ec2::254";
}

/**
 * Every navigation target must match an explicit origin. Link-local and
 * metadata addresses are rejected even if someone puts them on the allowlist.
 * Other private addresses are allowed only when that exact origin was listed.
 */
export function assertSafeNavigationUrl(raw: string, allowlist: URL[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PolicyError("invalid_url", "The navigation URL is not valid.");
  }
  if (url.username || url.password) {
    throw new PolicyError("url_credentials", "URLs that embed credentials are blocked.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PolicyError("url_scheme", `The URL scheme ${url.protocol} is blocked.`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (METADATA_HOSTS.has(host) || isMetadataAddress(host)) {
    throw new PolicyError("metadata_blocked", "Metadata endpoints are blocked.");
  }
  if (isIpLiteral(host) && isBlockedAddress(host)) {
    if (isMetadataAddress(host)) {
      throw new PolicyError("metadata_blocked", "Metadata endpoints are blocked.");
    }
    const listed = allowlist.some((entry) => sameOrigin(entry, url));
    if (!listed) {
      throw new PolicyError("private_network_blocked", "That private-network address is not allowlisted.");
    }
  }
  const listed = allowlist.some((entry) => sameOrigin(entry, url));
  if (!listed) {
    throw new PolicyError("domain_not_allowlisted", `Origin ${url.origin} is not allowlisted.`);
  }
  return url;
}

export function assertResolvedAddresses(
  host: string,
  addresses: ResolvedAddress[],
  allowlist: URL[],
): void {
  const normalized = normalizeIp(host.toLowerCase());
  if (METADATA_HOSTS.has(normalized)) {
    throw new PolicyError("metadata_blocked", "Metadata hostnames are blocked.");
  }
  if (addresses.length === 0) {
    throw new PolicyError("dns_failed", `No addresses were resolved for ${host}.`);
  }
  if (isIpLiteral(normalized)) return;
  for (const item of addresses) {
    if (isMetadataAddress(item.address)) {
      throw new PolicyError("metadata_blocked", "Resolved metadata addresses are blocked.");
    }
    if (isLoopbackAddress(item.address)) {
      const allowsLoopback = allowlist.some((entry) => {
        const allowedHost = entry.hostname.toLowerCase();
        return allowedHost === "localhost" || allowedHost.startsWith("127.");
      });
      if (!allowsLoopback) {
        throw new PolicyError("dns_rebinding_blocked", `${host} resolved to loopback, which is not allowlisted.`);
      }
      continue;
    }
    if (isBlockedAddress(item.address)) {
      throw new PolicyError("dns_rebinding_blocked", `${host} resolved to a private address.`);
    }
  }
}

export function substitutePortalOrigin(value: string, portalOrigin: string): string {
  return value.replaceAll("{{portalOrigin}}", portalOrigin.replace(/\/$/, ""));
}

export function substituteValues(value: string, values: Record<string, string>): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (full, key: string) => {
    if (key === "portalOrigin") return full;
    const found = values[key];
    return found ?? full;
  });
}

function sameOrigin(allow: URL, target: URL): boolean {
  return allow.protocol === target.protocol && allow.host.toLowerCase() === target.host.toLowerCase();
}

function unwrapIpv6(value: string): string {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

function normalizeIp(address: string): string {
  let host = unwrapIpv6(address.toLowerCase());
  if (host.startsWith("::ffff:")) host = host.slice("::ffff:".length);
  return host;
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    if (part.length > 1 && part.startsWith("0")) return false;
    return Number(part) <= 255;
  });
}

function isIpv6(value: string): boolean {
  return value.includes(":");
}
