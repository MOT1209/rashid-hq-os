"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  getToolOrDynamicToolName,
  isToolUIPart,
} from "ai";
import { Send, Sparkles } from "lucide-react";
import { useLocale } from "@/components/providers";
import { parseCommandHistory, pushCommandHistory } from "@/lib/client-storage";

const HISTORY_KEY = "command-history";
const MAX_HISTORY = 20;

/**
 * The single prompt box at the top of the dashboard. It talks to /api/console,
 * which runs the same registry tools the remote MCP endpoint exposes.
 */
export function CeoConsole() {
  const { t } = useLocale();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [history, setHistory] = useState<string[]>(() => {
    try {
      return parseCommandHistory(localStorage.getItem(HISTORY_KEY), MAX_HISTORY);
    } catch {
      return [];
    }
  });

  // -1 means "composing a new command"; 0..history.length-1 index into history.
  const [historyIndex, setHistoryIndex] = useState(-1);

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/console" }),
  });

  const busy = status === "submitted" || status === "streaming";

  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  /**
   * Every path that fills the box goes through here. Setting `input` alone
   * leaves the height wherever the last keystroke put it, so a recalled
   * multi-line command would sit clipped to one row.
   */
  const fill = (value: string) => {
    setInput(value);
    requestAnimationFrame(resize);
  };

  // Auto-scroll to latest message.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Persistence belongs here, not inside the setHistory updater: updaters have
  // to be pure, and StrictMode runs them twice in development.
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      // Storage full, disabled, or private mode — history stays in memory.
    }
  }, [history]);

  const submitCommand = (text: string) => {
    if (!text.trim() || busy) return;

    // Save to history (deduplicated, most-recent first); the effect persists it.
    setHistory((prev) => pushCommandHistory(prev, text, MAX_HISTORY));
    setHistoryIndex(-1);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    void sendMessage({ text });
  };

  const retryLastCommand = () => {
    if (busy) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const textPart = lastUser.parts.find((p) => p.type === "text");
    if (textPart && "text" in textPart) {
      // Deliberately not put back in the box: these tools perform real writes,
      // and leaving the text there primes an accidental second send.
      setInput("");
      setHistoryIndex(-1);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      void sendMessage({ text: textPart.text });
    }
  };

  return (
    <section className="rounded-2xl border border-accent/30 bg-panel p-5 shadow-sm">
      <form
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          submitCommand(input);
        }}
        className="flex items-end gap-3"
      >
        <Sparkles size={18} aria-hidden className="mb-2 shrink-0 text-accent" />
        <label htmlFor="ceo-console-input" className="sr-only">
          {t.consolePlaceholder}
        </label>
        <textarea
          ref={textareaRef}
          id="ceo-console-input"
          rows={1}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            event.target.style.height = "auto";
            event.target.style.height = `${event.target.scrollHeight}px`;
          }}
          onKeyDown={(event) => {
            // Mid-composition keys belong to the input method, not to us.
            if (event.nativeEvent.isComposing) return;

            const el = event.currentTarget;
            const caret = el.selectionStart;
            // A <textarea> holds multi-line drafts, so the arrows belong to the
            // caret first. History only takes over at the very edges, the way a
            // shell does: top line for back, bottom line for forward.
            const collapsed = caret === el.selectionEnd;
            const atFirstLine = collapsed && !el.value.slice(0, caret).includes("\n");
            const atLastLine = collapsed && !el.value.slice(caret).includes("\n");

            if (event.key === "Enter" && !event.shiftKey) {
              // The old <input> submitted on Enter and the <textarea> does not.
              // Shift+Enter is the newline, as in every chat box.
              event.preventDefault();
              submitCommand(el.value);
              return;
            }
            if (event.key === "ArrowUp" && history.length > 0 && atFirstLine) {
              event.preventDefault();
              const next = Math.min(historyIndex + 1, history.length - 1);
              setHistoryIndex(next);
              fill(history[next] ?? "");
              return;
            }
            if (event.key === "ArrowDown" && historyIndex >= 0 && atLastLine) {
              event.preventDefault();
              // Floor at -1 ("composing"). Without it the index ran off into
              // negatives and ArrowUp needed that many dead presses to recover.
              const next = historyIndex - 1;
              setHistoryIndex(next);
              fill(next >= 0 ? (history[next] ?? "") : "");
            }
          }}
          placeholder={t.consolePlaceholder}
          className="min-h-[2.5rem] min-w-0 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="mb-0.5 flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          <Send size={14} aria-hidden />
          {busy ? t.thinking : t.send}
        </button>
      </form>

      {error && (
        <div className="mt-3 flex items-center gap-2">
          <p role="alert" className="rounded-lg bg-err/10 px-3 py-2 text-xs text-err">
            {error.message}
          </p>
          <button
            type="button"
            onClick={retryLastCommand}
            className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs text-muted hover:text-text"
          >
            {t.tryAgain}
          </button>
        </div>
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
                if (isToolUIPart(part)) {
                  const toolName = getToolOrDynamicToolName(part);
                  // v5 renamed this field: a tool part carries `output` once
                  // `state` says so, and never a `result`.
                  const done = part.state === "output-available";
                  const failed = part.state === "output-error";
                  return (
                    <div key={index} className="my-2 rounded-lg bg-panel-2 p-3">
                      <p className="mb-1 text-[11px] font-medium text-accent">
                        {toolName}
                        {!done && !failed && (
                          <span className="ms-2 text-muted">{t.thinking}</span>
                        )}
                      </p>
                      {failed && (
                        <p className="text-xs text-err">{part.errorText}</p>
                      )}
                      {done && part.output != null && (
                        <pre className="max-h-64 overflow-auto text-xs whitespace-pre-wrap text-muted">
                          {typeof part.output === "string"
                            ? part.output
                            : JSON.stringify(part.output, null, 2)}
                        </pre>
                      )}
                    </div>
                  );
                }
                return null;
              })}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}
    </section>
  );
}
