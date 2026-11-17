import { PageSkeleton } from "@/components/ui/skeleton";

/**
 * Shown immediately on any navigation inside the app while the destination
 * renders on the server. Every screen here is dynamic (live data), and
 * without a loading state Next.js holds the old screen until the new one is
 * completely ready - which is what made switching sections feel stuck.
 */
export default function Loading() {
  return <PageSkeleton />;
}
