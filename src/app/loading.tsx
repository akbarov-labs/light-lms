import { PageSkeleton } from "@/components/page-fallbacks";

// Root level: shown while a layout outside the admin shell (or the shell itself) is still loading.
export default function RootLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageSkeleton stats={false} rows={5} />
    </div>
  );
}
