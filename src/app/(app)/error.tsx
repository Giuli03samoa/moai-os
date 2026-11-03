"use client";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/primitives";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const permission = /Permesso negato/i.test(error.message);
  return (
    <div className="mx-auto mt-10 max-w-lg">
      <Notice tone={permission ? "warn" : "bad"}>
        <p className="font-medium">{permission ? "Permesso insufficiente" : "Qualcosa è andato storto"}</p>
        <p className="mt-1 text-xs">{permission ? error.message : "L'errore è stato registrato nei log del server. Nessun dato è stato modificato."}{error.digest ? ` (rif. ${error.digest})` : ""}</p>
      </Notice>
      <div className="mt-4 flex gap-2">
        <Button onClick={reset} variant="outline" size="sm">Riprova</Button>
        <Button asChild size="sm"><a href="/">Torna all&apos;overview</a></Button>
      </div>
    </div>
  );
}
