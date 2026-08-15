"use client";

/**
 * Last resort: an error thrown by the root layout itself, before Providers or
 * the locale exist. It replaces <html>, so it carries its own markup and only
 * hardcoded bilingual text.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#070a0f",
          color: "#e8edf4",
          fontFamily: "system-ui, sans-serif",
          margin: 0,
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <h1 style={{ fontSize: "1.125rem", margin: 0 }}>
            Something went wrong · حدث خطأ ما
          </h1>
          {error.digest && (
            <p style={{ color: "#8b98a9", fontSize: "0.75rem" }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              padding: "0.5rem 1rem",
              borderRadius: "0.75rem",
              border: "none",
              background: "#d4af37",
              color: "#000",
              cursor: "pointer",
            }}
          >
            Try again · إعادة المحاولة
          </button>
        </div>
      </body>
    </html>
  );
}
