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

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

function sender() {
  // Resend requires a verified domain; onboarding@resend.dev works out of the
  // box for testing and only delivers to the account owner.
  return process.env.EMAIL_FROM ?? "Alking Enterprises <onboarding@resend.dev>";
}

export async function sendEmail(input: {
  to: string;
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
        to: [input.to],
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
        <a href="${url}" style="display:inline-block;background:#c9a227;color:#000;text-decoration:none;padding:.6rem 1.2rem;border-radius:.75rem;font-weight:600">
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
      <p style="font-size:.75rem;color:#5b6675;word-break:break-all;margin:0">${url}</p>
    </div>
  `;

  return sendEmail({ to, subject, html, text });
}
