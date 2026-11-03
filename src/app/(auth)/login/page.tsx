import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { readSession } from "@/server/auth/session";
import { loginAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input, Notice } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if ((await db.user.count()) === 0) redirect("/setup");
  const s = await readSession();
  if (s) redirect(s.user.mfaEnabledAt ? (s.mfaVerified ? "/" : "/mfa/verify") : "/mfa/setup");
  const { error } = await searchParams;
  return (
    <div>
      <h1 className="text-2xl font-medium">Accedi</h1>
      <p className="mt-1 text-sm text-graphite">Accesso riservato al team MOAI. È richiesta l&apos;autenticazione a due fattori.</p>
      <form action={loginAction} className="mt-6 flex flex-col gap-4">
        {error ? <Notice tone="bad">{error}</Notice> : null}
        <Field label="Email">
          <Input name="email" type="email" autoComplete="username" required autoFocus />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Button type="submit" size="lg">Continua</Button>
      </form>
    </div>
  );
}
