"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useLocale } from "@/components/providers";
import { matchProjects } from "@/lib/search";
import type { Project } from "@/types/database";

/**
 * Jump straight to a project by name. Filtering happens on the id/name list
 * the layout already loads, so typing costs nothing — no request per keystroke
 * and no new endpoint to authorise.
 *
 * Selecting one lands on the activity feed filtered to that project, which is
 * what "find this project" almost always means here.
 */
export function ProjectSearch({ projects }: { projects: Pick<Project, "id" | "name">[] }) {
  const { t } = useLocale();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => matchProjects(projects, query), [projects, query]);
  const open = query.trim().length > 0;

  function go(id: string) {
    setQuery("");
    setActive(0);
    inputRef.current?.blur();
    router.push(`/dashboard/activity?projectId=${encodeURIComponent(id)}`);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setQuery("");
      inputRef.current?.blur();
      return;
    }
    if (!open || matches.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(matches[Math.min(active, matches.length - 1)].id);
    }
  }

  return (
    <div className="relative">
      <Search
        size={15}
        aria-hidden
        className="pointer-events-none absolute inset-y-0 start-3 my-auto text-muted"
      />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder={t.searchProjects}
        aria-label={t.searchProjects}
        className="w-full rounded-xl border border-border bg-panel-2 py-2 pe-3 ps-9 text-sm outline-none focus:border-accent"
      />

      {open && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-panel shadow-lg">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted">{t.noProjects}</li>
          ) : (
            matches.map((project, i) => (
              <li key={project.id}>
                <button
                  type="button"
                  // onMouseDown, not onClick: the input's blur would close the
                  // list before a click ever landed.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(project.id);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`block w-full px-3 py-2 text-start text-sm ${
                    i === active ? "bg-panel-2 text-text" : "text-muted"
                  }`}
                >
                  {project.name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
