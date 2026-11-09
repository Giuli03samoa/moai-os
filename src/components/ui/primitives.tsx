import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Card ──
export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("surface rounded-[18px] border border-[var(--hairline)]", className)} {...p} />;
}
export function CardHeader({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-5 pb-3", className)} {...p} />;
}
export function CardTitle({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-[15px] font-medium leading-tight tracking-[-0.02em]", className)} {...p} />;
}
export function CardDescription({ className, ...p }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-graphite", className)} {...p} />;
}
export function CardContent({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-0", className)} {...p} />;
}

// ── Form controls ──
const control =
  "flex h-9 w-full rounded-xl border border-smoke bg-white px-3 py-1 text-sm text-blackout shadow-[inset_0_1px_1px_rgba(34,34,34,0.03)] transition-colors placeholder:text-space hover:border-steel focus-visible:border-graphite focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-graphite/15 disabled:opacity-50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn(control, className)} {...p} />);
Input.displayName = "Input";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => <select ref={ref} className={cn(control, "pr-8", className)} {...p} />);
Select.displayName = "Select";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn(control, "h-auto min-h-[80px] py-2", className)} {...p} />);
Textarea.displayName = "Textarea";

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-xs font-medium text-graphite", className)} {...p} />;
}

export function Field({ label, help, children, className }: { label: React.ReactNode; help?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label>{label}</Label>
      {children}
      {help ? <p className="text-xs text-space">{help}</p> : null}
    </div>
  );
}

// ── Badge ──
const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap", {
  variants: {
    tone: {
      ok: "bg-ok-bg text-ok",
      warn: "bg-warn-bg text-warn",
      bad: "bg-bad-bg text-bad",
      muted: "bg-cloud text-graphite",
      dark: "bg-blackout text-crocus",
      outline: "border border-smoke text-graphite",
    },
  },
  defaultVariants: { tone: "muted" },
});
export function Badge({ className, tone, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...p} />;
}

/** Small status dot, for lists where a full badge is too loud. */
export function Dot({ tone = "muted", className }: { tone?: "ok" | "warn" | "bad" | "muted"; className?: string }) {
  const map = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", muted: "bg-space" };
  return <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", map[tone], className)} />;
}

// ── Table ──
export function Table({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} {...p} />
    </div>
  );
}
export function THead({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("[&_tr]:border-b [&_tr]:border-smoke", className)} {...p} />;
}
export function TBody({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...p} />;
}
export function TR({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-smoke/60 transition-colors hover:bg-cloud/70", className)} {...p} />;
}
export function TH({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("h-10 px-4 text-left align-middle text-[11px] font-medium text-graphite", className)} {...p} />;
}
export function TD({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...p} />;
}

// ── Misc ──
export function Empty({ title, children, icon }: { title: string; children?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="chevron-pattern-ink flex flex-col items-center justify-center gap-2 rounded-[18px] border border-dashed border-steel/70 px-6 py-14 text-center">
      {icon ? <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-cloud text-graphite">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {children ? <div className="max-w-md text-sm text-graphite">{children}</div> : null}
    </div>
  );
}

export function Notice({ tone = "muted", children }: { tone?: "ok" | "warn" | "bad" | "muted"; children: React.ReactNode }) {
  const map = { ok: "border-ok/25 bg-ok-bg text-ok", warn: "border-warn/25 bg-warn-bg text-warn", bad: "border-bad/25 bg-bad-bg text-bad", muted: "border-smoke bg-cloud text-graphite" };
  const Icon = { ok: CheckCircle2, warn: AlertTriangle, bad: OctagonAlert, muted: Info }[tone];
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm", map[tone])}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1.5 text-xs font-medium text-graphite">{eyebrow}</p> : null}
        <h1 className="text-[28px] font-medium leading-[1.1] tracking-[-0.035em] md:text-[32px]">{title}</h1>
        {subtitle ? <p className="mt-2 max-w-2xl text-sm text-graphite">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Section label used between blocks of a page. */
export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 mt-9 flex items-center justify-between gap-3">
      <h2 className="text-[13px] font-medium text-graphite">{children}</h2>
      {action}
    </div>
  );
}
