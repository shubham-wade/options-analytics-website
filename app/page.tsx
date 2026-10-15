import { Suspense } from "react";
import { Dashboard } from "@/components/dashboard/dashboard";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <Suspense fallback={<main className="p-8 text-sm text-muted-foreground">Loading NIFTY Risk Lab…</main>}>
      <Dashboard />
    </Suspense>
  );
}
