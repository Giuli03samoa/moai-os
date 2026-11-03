import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { setupAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input, Notice } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if ((await db.user.count()) > 0) redirect("/login");
  const { error } = await searchParams;
  return (
    <div>
      <h1 className="text-2xl font-medium">Prima configurazione</h1>
      <p className="mt-1 text-sm text-graphite">Crea l&apos;organizzazione e l&apos;utente proprietario. Questa pagina si disattiva dopo il primo utente.</p>
      <form action={setupAction} className="mt-6 flex flex-col gap-4">
        {error ? <Notice tone="bad">{error}</Notice> : null}
        <Field label="Nome organizzazione">
          <Input name="orgName" defaultValue="MOAI Athletics" required />
        </Field>
        <Field label="Partita IVA" help="Serve a classificare le fatture emesse/ricevute. Modificabile in Settings.">
          <Input name="vatNumber" placeholder="IT01234567890" />
        </Field>
        <Field label="Il tuo nome">
          <Input name="name" required />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" autoComplete="username" required />
        </Field>
        <Field label="Password" help="Minimo 12 caratteri con maiuscole, minuscole e numeri.">
          <Input name="password" type="password" autoComplete="new-password" minLength={12} required />
        </Field>
        <Button type="submit" size="lg">Crea e continua con MFA</Button>
      </form>
    </div>
  );
}
