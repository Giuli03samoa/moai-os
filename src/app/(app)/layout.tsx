import { requireAuth } from "@/server/auth/session";
import { db } from "@/server/db";
import { isAgentConfigured } from "@/server/agent/config";
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
    <AppShell
      user={{ name: auth.name, role: auth.role, orgName: auth.orgName }}
      demo={process.env.DEMO_MODE === "true"}
      assistantEnabled={isAgentConfigured()}
      badges={{ "/alerts": alerts, "/tasks": tasks, "/assistant": approvals }}
    >
      {children}
    </AppShell>
  );
}
