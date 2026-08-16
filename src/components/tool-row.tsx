"use client";

import { useActionState, useId, useState } from "react";
import { Check, Pencil, PlugZap, Trash2 } from "lucide-react";
import {
  deleteProjectToolAction,
  testProjectToolAction,
  updateProjectToolAction,
} from "@/app/actions";
import { useLocale } from "@/components/providers";
import { Field, FormError, fieldClass } from "@/components/ui";
import type { ProjectTool } from "@/types/database";

type State = { error?: string; ok?: boolean; result?: string } | null;

/**
 * A registered MCP tool. Until now tools could only be added: a typo'd endpoint
 * was permanent, and the only way to learn whether it worked was to wait for a
 * real agent call to fail.
 */
export function ToolRow({
  tool,
  projectName,
  canEdit = true,
}: {
  tool: ProjectTool;
  projectName: string;
  /** Presentation only — the server actions enforce the same rule. */
  canEdit?: boolean;
}) {
  const { t } = useLocale();
  const id = useId();
  const [editing, setEditing] = useState(false);

  const [state, save, saving] = useActionState<State, FormData>(
    async (_prev, formData) => {
      const result = await updateProjectToolAction(formData);
      if (result?.ok) setEditing(false);
      return result;
    },
    null,
  );

  const [testState, runTest, testing] = useActionState<State, FormData>(
    async (_prev, formData) => testProjectToolAction(formData),
    null,
  );

  if (editing) {
    return (
      <li className="py-3">
        <form action={save} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={tool.id} />

          <Field id={`${id}-name`} label={t.tool}>
            <input
              id={`${id}-name`}
              name="tool_name"
              defaultValue={tool.tool_name}
              required
              className={fieldClass}
            />
          </Field>

          <Field id={`${id}-endpoint`} label={t.endpoint}>
            <input
              id={`${id}-endpoint`}
              name="endpoint"
              type="url"
              defaultValue={tool.endpoint ?? ""}
              className={fieldClass}
            />
          </Field>

          <Field id={`${id}-desc`} label={t.description}>
            <input
              id={`${id}-desc`}
              name="description"
              defaultValue={tool.description ?? ""}
              className={fieldClass}
            />
          </Field>

          <div className="sm:col-span-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
            >
              {t.save}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-xl border border-border px-4 py-2 text-sm text-muted"
            >
              {t.cancel}
            </button>
            {state?.error && <FormError>{state.error}</FormError>}
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <code className="text-accent">{tool.tool_name}</code>
        <span className="ms-2 text-xs text-muted">· {projectName}</span>
        {tool.description && (
          <p className="text-xs text-muted">{tool.description}</p>
        )}
        {testState?.error && (
          <p role="alert" className="mt-1 text-[11px] text-err">
            {testState.error}
          </p>
        )}
        {testState?.ok && (
          <p role="status" className="mt-1 flex items-center gap-1 text-[11px] text-ok">
            <Check size={12} aria-hidden />
            {t.testPassed}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="max-w-56 truncate text-xs text-muted">
          {tool.endpoint ?? "—"}
        </span>

        {canEdit && (
        <form action={runTest}>
          <input type="hidden" name="project_id" value={tool.project_id} />
          <input type="hidden" name="tool_name" value={tool.tool_name} />
          <button
            type="submit"
            disabled={testing || !tool.endpoint}
            aria-label={`${t.test}: ${tool.tool_name}`}
            title={t.test}
            className="rounded-lg p-1.5 text-muted hover:bg-panel-2 hover:text-text disabled:opacity-30"
          >
            <PlugZap size={15} aria-hidden />
          </button>
        </form>
        )}

        {canEdit && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`${t.edit}: ${tool.tool_name}`}
          className="rounded-lg p-1.5 text-muted hover:bg-panel-2 hover:text-text"
        >
          <Pencil size={15} aria-hidden />
        </button>
        )}

        {canEdit && <DeleteTool toolId={tool.id} toolName={tool.tool_name} />}
      </div>
    </li>
  );
}

function DeleteTool({ toolId, toolName }: { toolId: string; toolName: string }) {
  const { t } = useLocale();
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => deleteProjectToolAction(formData),
    null,
  );

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`${t.confirmDeleteTool}\n\n${toolName}`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={toolId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`${t.delete}: ${toolName}`}
        className="rounded-lg p-1.5 text-err hover:bg-err/10 disabled:opacity-40"
      >
        <Trash2 size={15} aria-hidden />
      </button>
      {state?.error && (
        <p role="alert" className="text-[11px] text-err">
          {state.error}
        </p>
      )}
    </form>
  );
}
