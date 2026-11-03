export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen md:grid-cols-[1fr_1.1fr]">
      <div className="chevron-pattern hidden flex-col justify-between bg-blackout p-10 text-crocus md:flex">
        <div>
          <span className="text-2xl font-medium tracking-[-0.04em]">MOAI</span>
          <span className="ml-2 text-xs uppercase tracking-[0.2em] text-space">OS</span>
        </div>
        <div>
          <p className="text-4xl font-medium leading-tight tracking-[-0.03em]">Discipline<br />over noise.</p>
          <p className="mt-4 max-w-sm text-sm text-space">Ordini, pagamenti, fatture e spedizioni in un&apos;unica vista. Nessuna operazione fiscale o finanziaria irreversibile viene automatizzata.</p>
        </div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-space">MOAI Athletics · piattaforma gestionale interna</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
