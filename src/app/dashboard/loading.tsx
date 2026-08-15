import { PanelSkeleton, Skeleton, StatCardsSkeleton } from "@/components/skeleton";

/**
 * Every dashboard route awaits Supabase before rendering, so without this the
 * browser sits on the previous page during navigation with no feedback.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-20 w-full" />
      <StatCardsSkeleton />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PanelSkeleton rows={5} />
        </div>
        <PanelSkeleton rows={4} />
      </div>
    </div>
  );
}
