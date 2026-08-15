"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Send, Sparkles } from "lucide-react";
import { useLocale } from "@/components/providers";

/**
 * The single prompt box at the top of the dashboard. It talks to /api/console,
 * which runs the same registry tools the remote MCP endpoint exposes.
 */
export function CeoConsole() {
  const { t } = useLocale();
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/console" }),
  });

  const busy = status === "submitted" || status === "streaming";

  return (
    <section className="rounded-2xl border border-accent/30 bg-panel p-5 shadow-sm">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const text = input.trim();
          if (!text || busy) return;
          setInput("");
          void sendMessage({ text });
        }}
        className="flex items-center gap-3"
      >
        <Sparkles size={18} aria-hidden className="shrink-0 text-accent" />
        <label htmlFor="ceo-console-input" className="sr-only">
          {t.consolePlaceholder}
        </label>
        <input
          id="ceo-console-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t.consolePlaceholder}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          <Send size={14} aria-hidden />
          {busy ? t.thinking : t.send}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-err/10 px-3 py-2 text-xs text-err">
          {error.message}
        </p>
      )}

      {messages.length > 0 && (
        <div
          aria-live="polite"
          className="mt-4 max-h-80 space-y-3 overflow-auto border-t border-border pt-4"
        >
          {messages.map((message) => (
            <div key={message.id} className="text-sm">
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted">
                {message.role === "user" ? t.ceo : t.brand}
              </p>
              {message.parts.map((part, index) => {
                if (part.type === "text") {
                  return (
                    <p key={index} className="whitespace-pre-wrap leading-relaxed">
                      {part.text}
                    </p>
                  );
                }
                if (part.type.startsWith("tool-")) {
                  return (
                    <code
                      key={index}
                      className="me-2 inline-block rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-accent"
                    >
                      {part.type.replace("tool-", "")}
                    </code>
                  );
                }
                return null;
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
