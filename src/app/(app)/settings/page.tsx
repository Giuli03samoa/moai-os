import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { changePasswordAction, createUserAction, deleteDemoDataAction, removeUserAction, resetUserMfaAction, setUserRoleAction, updateOrgAction } from "@/server/actions/settings";
import { fmtDate } from "@/lib/format";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Notice, PageHeader, Select, TBody, TD, TH, THead, TR, Table } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

const ROLES = ["OWNER", "ADMIN", "ACCOUNTANT", "OPERATIONS", "VIEWER"] as const;
const ROLE_HELP: Record<string, string> = { OWNER: "tutto, inclusi altri owner", ADMIN: "integrazioni, utenti, impostazioni", ACCOUNTANT: "riconciliazione, pagamenti fatture, import", OPERATIONS: "sync, upload XML, import CSV, spedizioni", VIEWER: "sola lettura ed export" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const auth = await requireAuth();
  const sp = await searchParams;
  const isAdmin = hasRole(auth.role, "ADMIN");
  const [org, members, audit, demoCount, sessions] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: auth.organizationId } }),
    db.membership.findMany({ where: { organizationId: auth.organizationId }, include: { user: { select: { id: true, name: true, email: true, mfaEnabledAt: true, lastLoginAt: true, lockedUntil: true } } }, orderBy: { createdAt: "asc" } }),
    isAdmin ? db.auditLog.findMany({ where: { organizationId: auth.organizationId }, orderBy: { createdAt: "desc" }, take: 60, include: { user: { select: { name: true } } } }) : Promise.resolve([]),
    db.order.count({ where: { organizationId: auth.organizationId, isDemo: true } }),
    db.session.count({ where: { organizationId: auth.organizationId, revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  return (
    <div>
      <PageHeader title="Settings" subtitle={`Organizzazione, utenti e sicurezza. Sessioni attive: ${sessions}.`} />
      {sp.notice ? <div className="mb-4"><Notice tone="ok">{sp.notice}</Notice></div> : null}
      {sp.error ? <div className="mb-4"><Notice tone="bad">{sp.error}</Notice></div> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Organizzazione</CardTitle><CardDescription>La P.IVA classifica le fatture (emesse/ricevute) e filtra gli account Aruba multi-azienda. Il fuso orario definisce i confini giornalieri di tutti i report.</CardDescription></CardHeader>
          <CardContent>
            <form action={updateOrgAction} className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome" className="sm:col-span-2"><Input name="name" defaultValue={org.name} disabled={!isAdmin} required /></Field>
              <Field label="Partita IVA"><Input name="vatNumber" defaultValue={org.vatNumber ?? ""} placeholder="01234567890" disabled={!isAdmin} /></Field>
              <Field label="Codice fiscale"><Input name="fiscalCode" defaultValue={org.fiscalCode ?? ""} disabled={!isAdmin} /></Field>
              <Field label="Fuso orario"><Input name="timezone" defaultValue={org.timezone} disabled={!isAdmin} /></Field>
              <Field label="Valuta base"><Input name="baseCurrency" defaultValue={org.baseCurrency} maxLength={3} disabled={!isAdmin} /></Field>
              {isAdmin ? <div className="sm:col-span-2"><Button type="submit">Salva</Button></div> : null}
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>La tua sicurezza</CardTitle><CardDescription>{auth.email} · ruolo {auth.role}. MFA obbligatoria per tutti.</CardDescription></CardHeader>
          <CardContent>
            <form action={changePasswordAction} className="grid gap-3 sm:grid-cols-2">
              <Field label="Password attuale"><Input name="current" type="password" autoComplete="current-password" required /></Field>
              <Field label="Nuova password" help="≥ 12 caratteri, maiuscole, minuscole, numeri"><Input name="next" type="password" autoComplete="new-password" minLength={12} required /></Field>
              <div className="sm:col-span-2"><Button type="submit" variant="outline">Cambia password</Button></div>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Utenti</CardTitle><CardDescription>Least privilege: assegna il ruolo minimo necessario. {Object.entries(ROLE_HELP).map(([r, h]) => `${r}: ${h}`).join(" · ")}</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Table>
              <THead><TR><TH>Nome</TH><TH>Email</TH><TH>Ruolo</TH><TH>MFA</TH><TH>Ultimo accesso</TH>{isAdmin ? <TH></TH> : null}</TR></THead>
              <TBody>
                {members.map((m) => (
                  <TR key={m.id}>
                    <TD className="font-medium">{m.user.name}{m.user.id === auth.userId ? <span className="ml-1 text-xs text-graphite">(tu)</span> : null}</TD><TD className="text-xs">{m.user.email}</TD>
                    <TD>{isAdmin && m.user.id !== auth.userId ? <form action={setUserRoleAction} className="flex gap-1"><input type="hidden" name="userId" value={m.user.id} /><Select name="role" defaultValue={m.role} className="h-7 w-36 text-xs">{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</Select><Button size="sm" variant="outline">OK</Button></form> : <Badge tone="dark">{m.role}</Badge>}</TD>
                    <TD>{m.user.mfaEnabledAt ? <Badge tone="ok">attiva</Badge> : <Badge tone="warn">da attivare</Badge>}{m.user.lockedUntil && m.user.lockedUntil > new Date() ? <Badge tone="bad" className="ml-1">bloccato</Badge> : null}</TD>
                    <TD className="text-xs">{fmtDate(m.user.lastLoginAt, auth.timezone, true)}</TD>
                    {isAdmin ? <TD>{m.user.id !== auth.userId ? <div className="flex gap-1"><form action={resetUserMfaAction}><input type="hidden" name="userId" value={m.user.id} /><Button size="sm" variant="ghost">Reset MFA</Button></form><form action={removeUserAction}><input type="hidden" name="userId" value={m.user.id} /><Button size="sm" variant="ghost" className="text-bad">Revoca</Button></form></div> : null}</TD> : null}
                  </TR>
                ))}
              </TBody>
            </Table>
            {isAdmin ? (
              <details className="rounded-lg border border-smoke p-3">
                <summary className="cursor-pointer text-sm font-medium">Aggiungi utente</summary>
                <form action={createUserAction} className="mt-3 grid gap-3 sm:grid-cols-4">
                  <Field label="Nome"><Input name="name" required /></Field>
                  <Field label="Email"><Input name="email" type="email" required /></Field>
                  <Field label="Ruolo"><Select name="role" defaultValue="VIEWER">{ROLES.filter((r) => r !== "OWNER" || auth.role === "OWNER").map((r) => <option key={r} value={r}>{r}</option>)}</Select></Field>
                  <Field label="Password iniziale" help="da comunicare su canale sicuro"><Input name="password" type="text" autoComplete="off" minLength={12} required /></Field>
                  <div className="sm:col-span-4"><Button type="submit" size="sm">Crea</Button></div>
                </form>
              </details>
            ) : null}
          </CardContent>
        </Card>

        {isAdmin ? (
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Dati demo</CardTitle><CardDescription>{demoCount ? `${demoCount} ordini demo presenti (etichettati DEMO in ogni tabella).` : "Nessun dato demo. Per crearne: npm run db:seed-demo (solo ambiente demo)."} DEMO_MODE={process.env.DEMO_MODE ?? "false"}.</CardDescription></CardHeader>
            {demoCount ? <CardContent><form action={deleteDemoDataAction}><Button type="submit" variant="destructive" size="sm">Elimina tutti i dati demo</Button></form></CardContent> : null}
          </Card>
        ) : null}

        {isAdmin ? (
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Audit log</CardTitle><CardDescription>Ultime 60 azioni. Accessi, modifiche integrazioni, decisioni di riconciliazione, modifiche manuali, export.</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <THead><TR><TH>Quando</TH><TH>Chi</TH><TH>Azione</TH><TH>Entità</TH><TH>Dettagli</TH></TR></THead>
                <TBody>
                  {audit.map((a) => (
                    <TR key={a.id}><TD className="whitespace-nowrap text-xs">{fmtDate(a.createdAt, auth.timezone, true)}</TD><TD className="text-xs">{a.user?.name ?? "sistema"}</TD><TD className="font-mono text-xs">{a.action}</TD><TD className="text-xs">{a.entityType ? `${a.entityType} ${a.entityId?.slice(0, 10) ?? ""}` : ""}</TD><TD className="max-w-md truncate font-mono text-[11px] text-graphite" title={JSON.stringify(a.metadata)}>{JSON.stringify(a.metadata).slice(0, 140)}</TD></TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
