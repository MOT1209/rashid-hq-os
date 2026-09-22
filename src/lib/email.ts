import "server-only";

/**
 * Transactional email through Resend.
 *
 * Optional by design: without RESEND_API_KEY nothing sends and nothing breaks —
 * the calls log and return false. That keeps a deployment without the
 * integration working exactly as it did before, while the moment the key
 * appears password reset starts working with no code change.
 *
 * Called over HTTP rather than through the SDK so there is no extra dependency
 * for one endpoint.
 */

const ENDPOINT = "https://api.resend.com/emails";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * HTML-escapes a single interpolated value for the templates below. Most of
 * what lands there is admin-entered or agent-generated (project names,
 * endpoints, standing-task summaries), so it must never be injected as markup.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

function sender() {
  // Resend requires a verified domain; onboarding@resend.dev works out of the
  // box for testing and only delivers to the account owner.
  return process.env.EMAIL_FROM ?? "Alking Enterprises <onboarding@resend.dev>";
}

export async function sendEmail(input: {
  /** One address, or several for an alert that goes to every owner. */
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(`[email] RESEND_API_KEY unset; not sending "${input.subject}"`);
    return false;
  }

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: sender(),
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      // Never log the body verbatim — it echoes the recipient back.
      console.error(`[email] send failed with status ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[email] send threw:", error);
    return false;
  }
}

/**
 * Health-check alert. Sent by the daily cron when a project's endpoint has
 * failed several runs in a row — until now a dead integration only showed up
 * in Live Activity, so nobody learned about it without opening the console.
 *
 * Sent once at the moment the streak crosses the threshold, not on every run
 * after it, so a project that stays down does not mail every single day.
 */
export async function sendHealthAlert(
  to: string[],
  project: { name: string; endpoint: string; failures: number },
) {
  if (to.length === 0) return false;
  const subject = `تعذّر الوصول إلى ${project.name} · ${project.name} is failing health checks`;

  const text = [
    `فشل الفحص الصحي لمشروع "${project.name}" ${project.failures} مرات متتالية.`,
    `النقطة: ${project.endpoint}`,
    "افتح مركز القيادة لمراجعة السجل.",
    "",
    `The health check for "${project.name}" has failed ${project.failures} times in a row.`,
    `Endpoint: ${project.endpoint}`,
    "Open the command center to review the log.",
  ].join("\n");

  const html = `
    <div style="font-family:system-ui,'Segoe UI',Tahoma,sans-serif;max-width:32rem;margin:0 auto;padding:1.5rem;color:#10151c">
      <p style="color:#a8871d;font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;margin:0 0 1rem">
        Alking Enterprises
      </p>
      <div dir="rtl" style="margin-bottom:1.5rem">
        <h1 style="font-size:1.15rem;margin:0 0 .5rem">تعذّر الوصول إلى ${escapeHtml(project.name)}</h1>
        <p style="margin:0 0 .5rem;line-height:1.7">
          فشل الفحص الصحي ${project.failures} مرات متتالية.
        </p>
        <p style="margin:0;font-size:.8rem;color:#5b6675;word-break:break-all">${escapeHtml(project.endpoint)}</p>
      </div>
      <div>
        <h2 style="font-size:1rem;margin:0 0 .5rem">${escapeHtml(project.name)} is failing health checks</h2>
        <p style="margin:0;line-height:1.7">
          The scheduled health check has failed ${project.failures} times in a row.
        </p>
      </div>
    </div>
  `;

  return sendEmail({ to, subject, html, text });
}

/**
 * Daily digest for the standing-task cron. Those runs happen at 07:00 UTC with
 * nobody watching, and until now the only trace was a JSON blob in the
 * activity stream — so a department agent could report a real problem and no
 * one would read it for days.
 *
 * One mail for the whole batch, not one per department: a console with five
 * departments should not produce five emails every morning.
 */
export async function sendStandingTaskDigest(
  to: string[],
  runs: { department: string; ok: boolean; summary: string }[],
) {
  if (to.length === 0 || runs.length === 0) return false;

  const failures = runs.filter((run) => !run.ok).length;
  const subject = failures
    ? `المهام الدائمة: ${failures} فشل · Standing tasks: ${failures} failed`
    : `المهام الدائمة: ${runs.length} تشغيلة · Standing tasks: ${runs.length} run`;

  const text = runs
    .map((run) => `${run.ok ? "✓" : "✗"} ${run.department}\n${run.summary}`)
    .join("\n\n");

  const items = runs
    .map(
      (run) => `
      <li style="margin-bottom:1rem;list-style:none">
        <p style="margin:0 0 .25rem;font-weight:600">
          <span style="color:${run.ok ? "#17924a" : "#d13b3b"}">${run.ok ? "✓" : "✗"}</span>
          ${escapeHtml(run.department)}
        </p>
        <p style="margin:0;line-height:1.7;color:#5b6675;white-space:pre-wrap">${escapeHtml(run.summary)}</p>
      </li>`,
    )
    .join("");

  const html = `
    <div style="font-family:system-ui,'Segoe UI',Tahoma,sans-serif;max-width:32rem;margin:0 auto;padding:1.5rem;color:#10151c">
      <p style="color:#a8871d;font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;margin:0 0 1rem">
        Alking Enterprises
      </p>
      <h1 style="font-size:1.15rem;margin:0 0 1rem">
        المهام الدائمة · Standing tasks
      </h1>
      <ul style="margin:0;padding:0">${items}</ul>
    </div>
  `;

  return sendEmail({ to, subject, html, text });
}

/**
 * Password reset. Bilingual because the console is, and the recipient's locale
 * is not known at send time.
 */
export async function sendPasswordReset(to: string, url: string) {
  const subject = "إعادة تعيين كلمة المرور · Reset your password";

  const text = [
    "اطلب أحدهم إعادة تعيين كلمة مرور حسابك في مركز قيادة Alking Enterprises.",
    `افتح هذا الرابط: ${url}`,
    "إن لم تطلب ذلك، تجاهل هذه الرسالة — لن يتغيّر شيء.",
    "",
    "Someone asked to reset the password for your Alking Enterprises account.",
    `Open this link: ${url}`,
    "If that was not you, ignore this message — nothing will change.",
  ].join("\n");

  const html = `
    <div style="font-family:system-ui,'Segoe UI',Tahoma,sans-serif;max-width:32rem;margin:0 auto;padding:1.5rem;color:#10151c">
      <p style="color:#a8871d;font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;margin:0 0 1rem">
        Alking Enterprises
      </p>
      <div dir="rtl" style="margin-bottom:1.5rem">
        <h1 style="font-size:1.15rem;margin:0 0 .5rem">إعادة تعيين كلمة المرور</h1>
        <p style="margin:0 0 1rem;line-height:1.7">
          طُلبت إعادة تعيين كلمة مرور حسابك. إن لم تطلب ذلك، تجاهل هذه الرسالة — لن يتغيّر شيء.
        </p>
      </div>
      <p style="margin:0 0 1.5rem">
        <a href="${escapeHtml(url)}" style="display:inline-block;background:#c9a227;color:#000;text-decoration:none;padding:.6rem 1.2rem;border-radius:.75rem;font-weight:600">
          إعادة التعيين · Reset password
        </a>
      </p>
      <div style="margin-bottom:1.5rem">
        <h2 style="font-size:1rem;margin:0 0 .5rem">Reset your password</h2>
        <p style="margin:0;line-height:1.7">
          Someone asked to reset the password for your account. If that was not you,
          ignore this message — nothing will change.
        </p>
      </div>
      <p style="font-size:.75rem;color:#5b6675;word-break:break-all;margin:0">${escapeHtml(url)}</p>
    </div>
  `;

  return sendEmail({ to, subject, html, text });
}
