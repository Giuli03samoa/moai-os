"use client";

import { useActionState } from "react";
import Link from "next/link";
import { mfaConfirmAction, type MfaConfirmState } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input, Notice } from "@/components/ui/primitives";

export function MfaConfirmForm() {
  const [state, action, pending] = useActionState<MfaConfirmState, FormData>(mfaConfirmAction, {});
  if (state.recoveryCodes) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <Notice tone="ok">MFA attivata. Salva questi codici di recupero in un posto sicuro: vengono mostrati una sola volta e ognuno vale per un accesso.</Notice>
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-smoke bg-white p-4 font-mono text-sm">
          {state.recoveryCodes.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <Button asChild size="lg">
          <Link href="/">Ho salvato i codici, entra</Link>
        </Button>
      </div>
    );
  }
  return (
    <form action={action} className="mt-6 flex flex-col gap-4">
      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      <Field label="Codice a 6 cifre">
        <Input name="code" inputMode="numeric" pattern="[0-9 ]{6,7}" autoComplete="one-time-code" required autoFocus className="font-mono text-lg tracking-widest" />
      </Field>
      <Button type="submit" size="lg" disabled={pending}>{pending ? "Verifica…" : "Conferma e attiva"}</Button>
    </form>
  );
}
