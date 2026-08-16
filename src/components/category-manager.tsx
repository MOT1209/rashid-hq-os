"use client";

import { useActionState, useId } from "react";
import { Trash2 } from "lucide-react";
import { deleteCategoryAction, saveCategoryAction } from "@/app/actions";
import { useLocale } from "@/components/providers";
import { Field, FormError, fieldClass } from "@/components/ui";
import { categoryLabelOf, departmentName } from "@/lib/agents";
import type { Department, ProjectCategory } from "@/lib/agents";

type State = { error?: string; ok?: boolean } | null;

/**
 * Categories and their department routing, editable at runtime. They used to be
 * an array in src/lib/agents.ts with labels tied to dictionary keys, so a new
 * one meant a code change and a deploy.
 */
export function CategoryManager({
  categories,
  departments,
}: {
  categories: ProjectCategory[];
  departments: Department[];
}) {
  const { t, locale } = useLocale();
  const id = useId();

  const [state, save, saving] = useActionState<State, FormData>(
    async (_prev, formData) => saveCategoryAction(formData),
    null,
  );

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">{t.categoriesHint}</p>

      {categories.length > 0 && (
        <ul className="divide-y divide-border text-sm">
          {categories.map((c) => (
            <li key={c.value} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <span className="font-medium">{categoryLabelOf(c, locale)}</span>
                <code className="ms-2 text-xs text-muted">{c.value}</code>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">
                  {c.department_key
                    ? departmentName(
                        departments.find((d) => d.key === c.department_key) ??
                          departments[0],
                        locale,
                      )
                    : t.noDepartment}
                </span>
                <DeleteCategory value={c.value} label={categoryLabelOf(c, locale)} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <form action={save} className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-value`} label={t.categoryValue}>
          <input id={`${id}-value`} name="value" required className={fieldClass} />
        </Field>

        <Field id={`${id}-dept`} label={t.department}>
          <select id={`${id}-dept`} name="department_key" defaultValue="" className={fieldClass}>
            <option value="">{t.noDepartment}</option>
            {departments.map((d) => (
              <option key={d.key} value={d.key}>
                {departmentName(d, locale)}
              </option>
            ))}
          </select>
        </Field>

        <Field id={`${id}-ar`} label={t.labelAr}>
          <input id={`${id}-ar`} name="label_ar" required className={fieldClass} />
        </Field>

        <Field id={`${id}-en`} label={t.labelEn}>
          <input id={`${id}-en`} name="label_en" required className={fieldClass} />
        </Field>

        <div className="sm:col-span-2 flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
          >
            {t.addCategory}
          </button>
          {state?.error && <FormError>{state.error}</FormError>}
        </div>
      </form>
    </div>
  );
}

function DeleteCategory({ value, label }: { value: string; label: string }) {
  const { t } = useLocale();
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => deleteCategoryAction(formData),
    null,
  );

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`${t.confirmDeleteCategory}\n\n${label}`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="value" value={value} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`${t.delete}: ${label}`}
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
