import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Guards every outbound call this server makes on behalf of an agent.
 *
 * `call_project_tool` POSTs to an endpoint stored in the database and returns
 * the response to the caller. Without this check that is a full-read SSRF: any
 * agent token could register `http://169.254.169.254/…` (cloud metadata) or
 * `http://localhost:54321` (the Supabase admin surface) and read the answer.
 *
 * Set ALLOW_PRIVATE_MCP_ENDPOINTS=1 to talk to localhost during development.
 */

const BLOCKED_SUFFIXES = [".internal", ".local", ".localhost", ".home.arpa"];

function allowPrivate() {
  return process.env.ALLOW_PRIVATE_MCP_ENDPOINTS === "1";
}

function isPrivateIPv4(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(address: string): boolean {
  const value = address.toLowerCase().split("%")[0];
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("fe80")) return true; // link-local
  if (/^f[cd]/.test(value)) return true; // unique local
  if (value.startsWith("ff")) return true; // multicast
  // IPv4-mapped (::ffff:10.0.0.1) tunnels straight back to the v4 rules.
  const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

function isPrivateAddress(address: string, family: number): boolean {
  return family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address);
}

export class UnsafeEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeEndpointError";
  }
}

/**
 * Throws UnsafeEndpointError unless `value` is a public https URL.
 * Resolves DNS and checks every returned address, not just the hostname, so a
 * public name pointing at 127.0.0.1 is rejected too.
 */
export async function assertSafeEndpoint(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UnsafeEndpointError("Endpoint must be an absolute URL.");
  }

  const httpAllowed = allowPrivate() ? ["https:", "http:"] : ["https:"];
  if (!httpAllowed.includes(url.protocol)) {
    throw new UnsafeEndpointError("Endpoint must use https.");
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (allowPrivate()) return url;

  if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeEndpointError("Endpoint resolves to a private address.");
  }

  const literal = isIP(host);
  if (literal) {
    if (isPrivateAddress(host, literal)) {
      throw new UnsafeEndpointError("Endpoint resolves to a private address.");
    }
    return url;
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new UnsafeEndpointError("Endpoint hostname does not resolve.");
  }

  if (addresses.length === 0) {
    throw new UnsafeEndpointError("Endpoint hostname does not resolve.");
  }
  if (addresses.some((a) => isPrivateAddress(a.address, a.family))) {
    throw new UnsafeEndpointError("Endpoint resolves to a private address.");
  }

  return url;
}

/** Same check, as a boolean — for validating input before it is stored. */
export async function isSafeEndpoint(value: string): Promise<boolean> {
  try {
    await assertSafeEndpoint(value);
    return true;
  } catch {
    return false;
  }
}
