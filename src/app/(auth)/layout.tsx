import Image from "next/image";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen md:grid-cols-[1.05fr_1fr]">
      <div className="chevron-pattern relative hidden flex-col justify-between overflow-hidden bg-ink p-12 text-paper md:flex">
        <div className="desktop-titlebar-pad">
          <Image src="/brand/moai-logo-secondary-cream.png" alt="MOAI Athletics" width={150} height={50} priority className="h-auto w-[150px]" />
          <p className="mt-2 text-[10px] uppercase tracking-[0.3em] text-[#6e7180]">Operating System</p>
        </div>
        <div>
          <p className="text-[56px] font-medium leading-[0.98] tracking-[-0.045em]">Discipline<br />over noise.</p>
          <p className="mt-6 max-w-sm text-sm leading-relaxed text-[#9da2b3]">Ordini, pagamenti, fatture, produzione e brand in un unico posto, con un assistente che legge tutto e ti chiede conferma prima di ogni azione delicata.</p>
        </div>
        <Image src="/brand/moai-icon-cream.png" alt="" width={300} height={142} className="pointer-events-none absolute -bottom-6 -right-10 h-auto w-[300px] opacity-[0.06]" />
        <p className="text-[11px] uppercase tracking-[0.2em] text-[#6e7180]">MOAI Athletics · uso interno</p>
      </div>
      <div className="desktop-titlebar-pad flex items-center justify-center p-6">
        <div className="w-full max-w-sm animate-rise">
          <Image src="/brand/moai-icon-black.png" alt="MOAI" width={64} height={30} className="mb-8 h-auto w-[64px] dark:invert md:hidden" />
          {children}
        </div>
      </div>
    </div>
  );
}
