import { PageSkeleton } from "@/components/page-fallbacks";

export default function TeacherLoading() {
  return <PageSkeleton stats={false} rows={4} />;
}
