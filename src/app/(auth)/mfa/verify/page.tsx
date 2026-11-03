import { redirect } from "next/navigation";
import { readSession } from "@/server/auth/session";
import { logoutAction, mfaVerifyAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input, Notice } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function MfaVerifyPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await readSession();
  if (!s) redirect("/login");
  if (!s.user.mfaEnabledAt) redirect("/mfa/setup");
  if (s.mfaVerified) redirect("/");
  const { error } = await searchParams;
  return (
    <div>
      <h1 className="text-2xl font-medium">Verifica in due passaggi</h1>
      <p className="mt-1 text-sm text-graphite">Ciao {s.user.name}. Inserisci il codice dell&apos;app di autenticazione oppure un codice di recupero.</p>
      <form action={mfaVerifyAction} className="mt-6 flex flex-col gap-4">
        {error ? <Notice tone="bad">{error}</Notice> : null}
        <Field label="Codice">
          <Input name="code" autoComplete="one-time-code" required autoFocus className="font-mono text-lg tracking-widest" />
        </Field>
        <Button type="submit" size="lg">Entra</Button>
      </form>
      <form action={logoutAction} className="mt-4">
        <button className="text-sm text-graphite underline-offset-4 hover:underline">Usa un altro account</button>
      </form>
    </div>
  );
}
