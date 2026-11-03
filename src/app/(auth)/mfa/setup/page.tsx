import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { readSession } from "@/server/auth/session";
import { totpUri } from "@/server/auth/totp";
import { getPendingTotpSecret } from "@/server/actions/auth";
import { MfaConfirmForm } from "./confirm-form";

export const dynamic = "force-dynamic";

export default async function MfaSetupPage() {
  const s = await readSession();
  if (!s) redirect("/login");
  if (s.user.mfaEnabledAt) redirect(s.mfaVerified ? "/" : "/mfa/verify");
  const pending = await getPendingTotpSecret();
  if (!pending) redirect("/login");
  const uri = totpUri(pending.secret, pending.email);
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220, color: { dark: "#222222", light: "#ffffff" } });
  return (
    <div>
      <h1 className="text-2xl font-medium">Attiva l&apos;autenticazione a due fattori</h1>
      <p className="mt-1 text-sm text-graphite">Obbligatoria per tutti gli utenti. Scansiona il codice con un&apos;app TOTP (1Password, Google Authenticator, Authy…), poi inserisci il codice a 6 cifre.</p>
      <div className="mt-6 flex items-start gap-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="QR code TOTP" width={160} height={160} className="rounded-lg border border-smoke bg-white p-1" />
        <div className="text-xs text-graphite">
          <p className="font-medium text-blackout">Inserimento manuale</p>
          <p className="mt-1 break-all font-mono text-[11px]">{pending.secret}</p>
          <p className="mt-2">Algoritmo SHA-1 · 6 cifre · 30 s</p>
        </div>
      </div>
      <MfaConfirmForm />
    </div>
  );
}
