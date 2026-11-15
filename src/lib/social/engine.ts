import "server-only";

import { randomUUID } from "node:crypto";
import { logActivity } from "@/lib/activity";
import { getFreshAccessToken, markConnectionError } from "@/lib/integrations/connections";
import { nextAfterFailure, type FailureKind } from "@/lib/social/jobs";
import { canPublish } from "@/lib/social/providers";
import { publishToYouTube, type PublishResult } from "@/lib/social/adapters/youtube";
import { publishToFacebook, publishToInstagram } from "@/lib/social/adapters/meta";
import { db, type AccountRow, type AssetRow, type ContentRow, type JobRow, type VariantRow } from "@/lib/social/store";
import { hasErrors, validateVariant } from "@/lib/social/validation";

/**
 * Publishing engine. `processJob` is pure orchestration over injected `Deps`
 * so every branch is unit-tested without a database or network;
 * `runDueJobs` wires the real deps.
 *
 * Invariants:
 *  - a job is only marked succeeded from an adapter result with a
 *    platform-confirmed id;
 *  - auth/terminal failures never auto-retry;
 *  - one attempt row is written per execution, success or failure.
 */

export type JobContext = {
  content: ContentRow;
  variant: VariantRow;
  assets: AssetRow[];
  account: AccountRow;
};

export type Deps = {
  now: () => Date;
  loadContext: (job: JobRow) => Promise<JobContext | null>;
  publish: (job: JobRow, ctx: JobContext) => Promise<PublishResult>;
  startAttempt: (job: JobRow) => Promise<void>;
  finishAttempt: (job: JobRow, r: { ok: boolean; kind?: FailureKind; httpStatus?: number; error?: string; summary?: unknown }) => Promise<void>;
  finalize: (job: JobRow, patch: Record<string, unknown>) => Promise<void>;
  audit: (job: JobRow, status: "success" | "failed", detail: Record<string, unknown>) => Promise<void>;
};

export async function processJob(job: JobRow, deps: Deps): Promise<"succeeded" | "failed" | "requeued"> {
  await deps.startAttempt(job);
  const fail = async (kind: FailureKind, message: string, extra: { httpStatus?: number; retryAfterMs?: number; summary?: unknown } = {}) => {
    const next = nextAfterFailure(kind, job.attempts, deps.now(), extra.retryAfterMs);
    await deps.finishAttempt(job, { ok: false, kind, error: message, httpStatus: extra.httpStatus, summary: extra.summary });
    await deps.finalize(job, {
      status: next.status,
      error_kind: kind,
      last_error: message.slice(0, 500),
      locked_at: null,
      locked_by: null,
      ...(next.runAt ? { run_at: next.runAt.toISOString() } : { completed_at: deps.now().toISOString() }),
    });
    await deps.audit(job, "failed", { kind, message, attempts: job.attempts, willRetry: next.status === "queued" });
    return next.status === "queued" ? ("requeued" as const) : ("failed" as const);
  };

  if (!canPublish(job.platform)) {
    return fail("terminal", `${job.platform} publishing is not implemented.`);
  }

  let ctx: JobContext | null;
  try {
    ctx = await deps.loadContext(job);
  } catch (e) {
    return fail("retryable", `Could not load job data: ${e instanceof Error ? e.message : "error"}`);
  }
  if (!ctx) return fail("terminal", "The content, media or account for this job no longer exists.");
  if (ctx.account.status !== "active") return fail("terminal", "The target account is disabled.");

  const issues = validateVariant(
    {
      platform: job.platform,
      title: ctx.variant.title ?? ctx.content.title,
      caption: ctx.variant.caption ?? ctx.content.caption,
      hashtags: ctx.variant.hashtags ?? ctx.content.hashtags,
    },
    ctx.assets.map((a) => ({ kind: a.kind, mimeType: a.mime_type, sizeBytes: Number(a.size_bytes), durationSeconds: a.duration_seconds })),
  );
  if (hasErrors(issues)) return fail("terminal", `Validation failed: ${issues.filter((i) => i.severity === "error").map((i) => i.message).join(" ")}`);

  let result: PublishResult;
  try {
    result = await deps.publish(job, ctx);
  } catch (e) {
    // An exception AFTER bytes may have been sent is ambiguous; don't auto-retry.
    return fail("terminal", `Unexpected publishing error: ${e instanceof Error ? e.message : "error"}. Verify on the platform before retrying.`);
  }

  if (!result.ok) {
    return fail(result.kind, result.message, { httpStatus: result.httpStatus, retryAfterMs: result.retryAfterMs, summary: result.summary });
  }

  await deps.finishAttempt(job, { ok: true, summary: result.summary });
  await deps.finalize(job, {
    status: "succeeded",
    external_id: result.externalId,
    external_url: result.externalUrl,
    last_error: null,
    error_kind: null,
    locked_at: null,
    locked_by: null,
    completed_at: deps.now().toISOString(),
  });
  await deps.audit(job, "success", { externalId: result.externalId });
  return "succeeded";
}

/* ---------------- production wiring ---------------- */

function realDeps(): Deps {
  const supabase = db();
  return {
    now: () => new Date(),
    async loadContext(job) {
      const [content, variant, account, media] = await Promise.all([
        supabase.from("social_content").select("*").eq("id", job.content_id).eq("owner_id", job.owner_id).maybeSingle(),
        supabase.from("social_content_variants").select("*").eq("id", job.variant_id).maybeSingle(),
        supabase.from("social_accounts").select("*").eq("id", job.account_id).eq("owner_id", job.owner_id).maybeSingle(),
        supabase.from("social_content_media").select("asset_id, position").eq("content_id", job.content_id).order("position"),
      ]);
      if (content.error || variant.error || account.error || media.error) throw new Error("database read failed");
      if (!content.data || !variant.data || !account.data) return null;
      const ids = (media.data ?? []).map((m: { asset_id: string }) => m.asset_id);
      const assets = ids.length
        ? await supabase.from("social_media_assets").select("*").eq("owner_id", job.owner_id).in("id", ids)
        : { data: [], error: null };
      if (assets.error) throw new Error("database read failed");
      return { content: content.data, variant: variant.data, account: account.data, assets: assets.data ?? [] } as JobContext;
    },
    async publish(job, ctx) {
      const asset = ctx.assets[0];
      let token: string;
      try {
        token = await getFreshAccessToken(job.owner_id, ctx.account.connection_provider);
      } catch (e) {
        await markConnectionError(job.owner_id, ctx.account.connection_provider, "Authorization failed during publishing.", "error");
        return { ok: false, kind: "auth", message: `Account authorization failed: ${e instanceof Error ? e.message : "error"}` };
      }
      const title = ctx.variant.title ?? ctx.content.title;
      const caption = ctx.variant.caption ?? (ctx.content.caption || ctx.content.description);
      const tags = ctx.variant.hashtags ?? ctx.content.hashtags;
      if (job.platform === "youtube") {
        const privacyOpt = ctx.variant.options?.privacy;
        const privacy = privacyOpt === "public" || privacyOpt === "unlisted" ? privacyOpt : "private";
        return publishToYouTube({
          accessToken: token,
          title,
          description: caption,
          tags,
          privacy,
          mimeType: asset.mime_type,
          sizeBytes: Number(asset.size_bytes),
          openMedia: async () => {
            const { data, error } = await supabase.storage.from(asset.storage_bucket).createSignedUrl(asset.storage_path, 3600);
            if (error || !data) throw new Error("could not sign media URL");
            return fetch(data.signedUrl);
          },
        });
      }
      // Meta fetches media itself from a short-lived signed URL.
      let media: { kind: "video" | "image"; url: string } | null = null;
      if (asset) {
        const { data, error } = await supabase.storage.from(asset.storage_bucket).createSignedUrl(asset.storage_path, 3600);
        if (error || !data) return { ok: false, kind: "retryable", message: "Could not sign the media URL." };
        media = { kind: asset.kind, url: data.signedUrl };
      }
      const text = [caption, ...(tags.length ? [tags.map((t) => `#${t}`).join(" ")] : [])].filter(Boolean).join("\n\n");
      const input = { userToken: token, externalId: ctx.account.external_id, caption: text, title, media };
      if (job.platform === "facebook") return publishToFacebook(input);
      if (job.platform === "instagram") {
        return publishToInstagram({ ...input, pageId: String((ctx.account.metadata as Record<string, unknown>)?.page_id ?? "") });
      }
      return { ok: false, kind: "terminal", message: `${job.platform} publishing is not implemented.` };
    },
    async startAttempt(job) {
      await supabase.from("social_publish_attempts").upsert(
        { job_id: job.id, attempt_no: job.attempts, started_at: new Date().toISOString() },
        { onConflict: "job_id,attempt_no" },
      );
    },
    async finishAttempt(job, r) {
      await supabase
        .from("social_publish_attempts")
        .update({
          finished_at: new Date().toISOString(),
          outcome: r.ok ? "succeeded" : "failed",
          error_kind: r.kind ?? null,
          http_status: r.httpStatus ?? null,
          error: r.error?.slice(0, 500) ?? null,
          response: (r.summary ?? null) as never,
        })
        .eq("job_id", job.id)
        .eq("attempt_no", job.attempts);
    },
    async finalize(job, patch) {
      // Guarded on status so a concurrent cancel/finish is never overwritten.
      const { error } = await supabase
        .from("social_publish_jobs")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("status", "running");
      if (error) throw new Error("could not record the job result");
    },
    async audit(job, status, detail) {
      await logActivity({
        agentName: "Social Studio",
        toolName: `social.publish.${job.platform}`,
        status,
        payload: { jobId: job.id, ...detail } as never,
      }).catch(() => undefined);
    },
  };
}

/** Claims and runs due jobs. Safe to call concurrently (SKIP LOCKED claim). */
export async function runDueJobs(limit = 3, deps: Deps = realDeps()) {
  const worker = `w-${randomUUID().slice(0, 8)}`;
  const { data, error } = await db().rpc("claim_social_jobs", { p_limit: limit, p_worker: worker });
  if (error) throw new Error("Could not claim publishing jobs.");
  const jobs = (data ?? []) as JobRow[];
  const results: Record<string, string> = {};
  for (const job of jobs) {
    try {
      results[job.id] = await processJob(job, deps);
    } catch {
      // finalize itself failed; the 15-minute lock timeout lets the job be reclaimed.
      results[job.id] = "error";
    }
  }
  return { claimed: jobs.length, results };
}
