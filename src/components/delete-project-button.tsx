"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { deleteProjectAction } from "@/app/actions";
import { useLocale } from "@/components/providers";

/**
 * Deleting a project cascades to its logs and tools, so it asks first. The
 * confirm() runs before submit, which keeps this a plain form action.
 */
export function DeleteProjectButton({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const { t } = useLocale();
  const [, action, pending] = useActionState<null, FormData>(
    async (_prev, formData) => {
      await deleteProjectAction(formData);
      return null;
    },
    null,
  );

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`${t.confirmDelete}\n\n${projectName}`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={projectId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`${t.delete}: ${projectName}`}
        className="rounded-lg p-1.5 text-err hover:bg-err/10 disabled:opacity-40"
      >
        <Trash2 size={15} aria-hidden />
      </button>
    </form>
  );
}
