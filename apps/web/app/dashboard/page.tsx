import { DashboardShell } from "@/features/portfolio/dashboard-shell";

export default function DashboardPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-10 md:px-10">
      <DashboardShell />
    </main>
  );
}
