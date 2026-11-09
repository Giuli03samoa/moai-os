"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export type ThemeChoice = "light" | "dark" | "system";

export function setTheme(t: ThemeChoice) {
  try {
    localStorage.setItem("moai-theme", t);
  } catch {}
  (window as unknown as { __moaiTheme?: () => void }).__moaiTheme?.();
  window.dispatchEvent(new CustomEvent("moai-theme", { detail: t }));
}

export function readTheme(): ThemeChoice {
  try {
    return (localStorage.getItem("moai-theme") as ThemeChoice) || "system";
  } catch {
    return "system";
  }
}

/** Three-way segmented control: chiaro / automatico / scuro. */
export function ThemeToggle({ className }: { className?: string }) {
  const [t, setT] = useState<ThemeChoice>("system");
  useEffect(() => {
    setT(readTheme());
    const on = (e: Event) => setT((e as CustomEvent<ThemeChoice>).detail);
    window.addEventListener("moai-theme", on);
    return () => window.removeEventListener("moai-theme", on);
  }, []);
  const opts: Array<{ v: ThemeChoice; label: string; Icon: typeof Sun }> = [
    { v: "light", label: "Chiaro", Icon: Sun },
    { v: "system", label: "Automatico (come il Mac)", Icon: Monitor },
    { v: "dark", label: "Scuro", Icon: Moon },
  ];
  return (
    <div className={cn("inline-flex rounded-full bg-cloud p-0.5", className)} role="radiogroup" aria-label="Tema">
      {opts.map(({ v, label, Icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={t === v}
          title={label}
          onClick={() => {
            setTheme(v);
            setT(v);
          }}
          className={cn("flex h-7 w-8 items-center justify-center rounded-full text-graphite transition-colors hover:text-blackout", t === v && "bg-white text-blackout shadow-sm")}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      ))}
    </div>
  );
}
