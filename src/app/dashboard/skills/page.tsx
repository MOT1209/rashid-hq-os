import { SkillsManager, type SkillView } from "@/components/skills-manager";
import { getLocale } from "@/lib/locale-server";
import { requireSession } from "@/lib/session";
import { skillsT } from "@/lib/skills-i18n";
import { listSkills, listVersions, usageFor, getSkill } from "@/lib/skills-store";

export const dynamic = "force-dynamic";

type Params = { q?: string; tag?: string; status?: string; id?: string };

/**
 * Skills Manager. Read: any signed-in role. Every change is a server action
 * behind requireAdmin. Disabled skills are hidden from the console and from
 * the MCP list_skills/get_skill tools.
 */
export default async function SkillsPage({ searchParams }: { searchParams?: Promise<Params> }) {
  const [locale, session, params] = await Promise.all([getLocale(), requireSession(), searchParams]);
  const t = skillsT(locale);
  const enabled = params?.status === "enabled" ? true : params?.status === "disabled" ? false : undefined;

  const [skills, everything] = await Promise.all([
    listSkills({ q: params?.q, tag: params?.tag, enabled }),
    listSkills({}), // for the tag picker
  ]);
  const tags = [...new Set(everything.flatMap((s) => s.tags))].sort();

  const selectedId = params?.id && params.id !== "new" ? params.id : null;
  const selected = selectedId ? await getSkill(selectedId) : null;
  const [versions, usage] = selected ? await Promise.all([listVersions(selected.id), usageFor(selected.id)]) : [[], { total: 0, entries: [] }];

  const view = (s: (typeof skills)[number]): SkillView => ({
    id: s.id, name: s.name, description: s.description, prompt: s.prompt, enabled: s.enabled, version: s.version, tags: s.tags,
    inputSchema: s.input_schema ? JSON.stringify(s.input_schema, null, 2) : "", outputSchema: s.output_schema ? JSON.stringify(s.output_schema, null, 2) : "",
    metadata: Object.keys(s.metadata ?? {}).length ? JSON.stringify(s.metadata, null, 2) : "",
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <p className="text-sm text-muted">{t.subtitle}</p>
      </header>
      <SkillsManager
        t={t}
        locale={locale}
        canEdit={session.role === "admin"}
        skills={skills.map(view)}
        tags={tags}
        filters={{ q: params?.q ?? "", tag: params?.tag ?? "", status: params?.status ?? "" }}
        editing={params?.id === "new" ? "new" : selected ? view(selected) : null}
        versions={versions.map((v) => ({ version: v.version, name: v.name, savedAt: v.saved_at }))}
        usage={usage}
      />
    </div>
  );
}
