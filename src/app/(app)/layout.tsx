import { requireAuth } from "@/server/auth/session";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth("VIEWER");
  return (
    <AppShell auth={auth} demo={process.env.DEMO_MODE === "true"}>
      {children}
    </AppShell>
  );
}
