import { Shell } from "@/components/shell";
import { requireSession } from "@/lib/session";
import { fetchDepartments, fetchProjectOptions } from "@/lib/queries";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Departments drive the sidebar and now come from the database, so the
  // layout reads them once and hands them to the client shell. Projects come
  // along for the quick-search — two columns, ordered, so it stays cheap
  // enough to load on every dashboard page rather than per keystroke.
  const [, departments, projects] = await Promise.all([
    requireSession(),
    fetchDepartments(),
    fetchProjectOptions(),
  ]);
  return (
    <Shell departments={departments} projects={projects}>
      {children}
    </Shell>
  );
}
