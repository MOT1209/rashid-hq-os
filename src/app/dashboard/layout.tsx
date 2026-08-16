import { Shell } from "@/components/shell";
import { requireSession } from "@/lib/session";
import { fetchDepartments } from "@/lib/queries";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Departments drive the sidebar and now come from the database, so the
  // layout reads them once and hands them to the client shell.
  const [, departments] = await Promise.all([requireSession(), fetchDepartments()]);
  return <Shell departments={departments}>{children}</Shell>;
}
