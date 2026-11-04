import { requireAuth } from "@/server/auth/session";
import { db } from "@/server/db";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth("VIEWER");
  const [alerts, tasks, approvals] = await Promise.all([
    db.alert.count({ where: { organizationId: auth.organizationId, status: "OPEN" } }),
    db.task.count({ where: { organizationId: auth.organizationId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    db.agentApproval.count({ where: { organizationId: auth.organizationId, status: "PENDING" } }),
  ]);
  return (
    <AppShell auth={auth} demo={process.env.DEMO_MODE === "true"} badges={{ "/alerts": alerts, "/tasks": tasks, "/assistant": approvals }}>
      {children}
    </AppShell>
  );
}
