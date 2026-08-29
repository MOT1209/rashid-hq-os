import "server-only";

import { randomBytes } from "node:crypto";
import { getServiceSupabase } from "@/lib/supabase/server";
import { dbError } from "@/lib/errors";

/**
 * OAuth handshake state.
 *
 * Between /connect and /callback we hold a single-use row keyed by an
 * unguessable `state`: the CSRF token itself, the PKCE verifier, and where to
 * send the browser afterwards. The callback validates `state` matches, that it
 * belongs to the signed-in owner, and that it has not expired — then deletes
 * it, so a replayed callback finds nothing.
 */

export type OAuthState = {
  state: string;
  ownerId: string;
  provider: string;
  codeVerifier: string | null;
  redirectTo: string | null;
  scopes: string[];
};

/** The origin this console is served from, for building the callback URL. */
export function consoleOrigin(): string {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:7070";
}

export function callbackUrl(provider: string): string {
  return `${consoleOrigin()}/api/integrations/${provider}/callback`;
}

export async function createOAuthState(input: {
  /** Pass a value when the caller already needs it (to build the auth URL). */
  state?: string;
  ownerId: string;
  provider: string;
  codeVerifier?: string;
  redirectTo?: string;
  scopes: string[];
}): Promise<string> {
  const state = input.state ?? randomBytes(24).toString("base64url");
  const { error } = await getServiceSupabase().from("integration_oauth_states").insert({
    state,
    owner_id: input.ownerId,
    provider: input.provider,
    code_verifier: input.codeVerifier ?? null,
    redirect_to: input.redirectTo ?? null,
    scopes: input.scopes,
  });
  if (error) throw dbError("Starting the OAuth flow", error);
  return state;
}

/**
 * Consumes a state row: returns it if valid and unexpired, then deletes it.
 * Returns null for unknown, expired, or wrong-owner states.
 */
export async function consumeOAuthState(
  state: string,
  ownerId: string,
  provider: string,
): Promise<OAuthState | null> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("integration_oauth_states")
    .select("state, owner_id, provider, code_verifier, redirect_to, scopes, expires_at")
    .eq("state", state)
    .maybeSingle();
  if (error) throw dbError("Completing the OAuth flow", error);

  // Always delete on the way out — even a mismatched row, so a guessed state
  // cannot be probed twice.
  if (data) await supabase.from("integration_oauth_states").delete().eq("state", state);

  if (!data) return null;
  if (data.owner_id !== ownerId || data.provider !== provider) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;

  return {
    state: data.state,
    ownerId: data.owner_id,
    provider: data.provider,
    codeVerifier: data.code_verifier,
    redirectTo: data.redirect_to,
    scopes: data.scopes ?? [],
  };
}

/** Opportunistic cleanup of expired states. Cheap; called from /connect. */
export async function sweepExpiredStates(): Promise<void> {
  try {
    await getServiceSupabase()
      .from("integration_oauth_states")
      .delete()
      .lt("expires_at", new Date().toISOString());
  } catch {
    // non-critical
  }
}
