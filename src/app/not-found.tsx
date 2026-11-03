import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <p className="text-xs uppercase tracking-[0.2em] text-graphite">404</p>
      <h1 className="text-2xl font-medium">Pagina non trovata</h1>
      <Link href="/" className="text-sm underline">Torna all&apos;overview</Link>
    </div>
  );
}
