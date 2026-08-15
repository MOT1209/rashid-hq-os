"use client";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

let cached: ReturnType<typeof createClient<Database>> | null = null;

/**
 * Browser client. Read-only by RLS — it exists so the dashboard can subscribe
 * to Realtime changes on agent_logs. Every write goes through the server.
 */
export function getBrowserSupabase() {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }

  cached = createClient<Database>(url, key, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return cached;
}
