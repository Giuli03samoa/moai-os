import Link from "next/link";

export default function NotFound() {
  return (
    <div className="chevron-pattern-ink flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <p className="text-xs uppercase tracking-[0.25em] text-graphite">404</p>
      <h1 className="text-3xl font-medium tracking-[-0.035em]">Pagina non trovata</h1>
      <Link href="/" className="mt-2 rounded-full bg-blackout px-4 py-2 text-sm text-crocus">Torna alla panoramica</Link>
    </div>
  );
}
