import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * M1 (security review 2026-09-21): template strings in the HTML emails
 * interpolate admin- and agent-supplied values (project names, endpoints,
 * standing-task summaries). A value must never be executable as markup, so
 * every interpolation is escaped before it reaches the `html` field — while
 * the plain-text body stays literal.
 */

const fetchMock = vi.fn(
  async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 200 }),
);

function lastSent(): { html: string; text: string } {
  const [, init] = fetchMock.mock.calls.at(-1) ?? [];
  const body = JSON.parse(String(init?.body ?? "{}")) as {
    html: string;
    text: string;
  };
  return body;
}

afterEach(() => {
  fetchMock.mockClear();
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", async () => {
    const { escapeHtml } = await import("@/lib/email");
    expect(escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
  });

  it("leaves clean text untouched", async () => {
    const { escapeHtml } = await import("@/lib/email");
    expect(escapeHtml("simple summary ✓ 100%")).toBe("simple summary ✓ 100%");
  });
});

describe("email templates escape injections", () => {
  vi.stubGlobal("fetch", fetchMock);

  it("escapes the health alert", async () => {
    process.env.RESEND_API_KEY = "test";
    const { sendHealthAlert } = await import("@/lib/email");
    await sendHealthAlert(["owner@example.com"], {
      name: `<script>alert(1)</script>`,
      endpoint: `https://example.com/?a=1&b=2`,
      failures: 3,
    });

    const { html } = lastSent();
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("https://example.com/?a=1&amp;b=2");
    expect(html).not.toContain("<script>");
  });

  it("escapes the standing-task digest", async () => {
    process.env.RESEND_API_KEY = "test";
    const { sendStandingTaskDigest } = await import("@/lib/email");
    await sendStandingTaskDigest(["owner@example.com"], [
      { department: `Dev <b>`, ok: true, summary: `<img src=x onerror=alert(1)> done` },
    ]);

    const { html, text } = lastSent();
    expect(html).toContain("Dev &lt;b&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; done");
    expect(html).not.toContain("<img");
    // The plain-text twin keeps the raw value — it is text, not markup.
    expect(text).toContain("<img src=x onerror=alert(1)> done");
  });

  it("escapes the reset link in the href attribute", async () => {
    process.env.RESEND_API_KEY = "test";
    const { sendPasswordReset } = await import("@/lib/email");
    await sendPasswordReset("owner@example.com", `https://example.com/reset?t=abc&j=1`);

    const { html } = lastSent();
    expect(html).toContain('href="https://example.com/reset?t=abc&amp;j=1"');
    expect(html).not.toContain('href="https://example.com/reset?t=abc&j=1"');
  });
});