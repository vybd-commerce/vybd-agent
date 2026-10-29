"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { newBrandAction, signOutAction } from "@/app/actions";
import { STAGES, type Stage } from "@/lib/types";
import { Wordmark } from "./wordmark";

type BrandItem = { id: string; name: string; stage: Stage };

export function Sidebar({ brands, email, isOperator }: { brands: BrandItem[]; email: string; isOperator: boolean }) {
  const params = useParams<{ id?: string }>();
  const [open, setOpen] = useState(false);
  const stageLabel = (s: Stage) => STAGES.find((x) => x.key === s)?.label;

  return (
    <aside className="shrink-0 border-b border-line md:flex md:h-full md:w-[220px] md:flex-col md:border-r md:border-b-0">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/">
          <Wordmark />
        </Link>
        <button
          className="text-[13px] text-ink-2 md:hidden"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Close" : "Brands"}
        </button>
      </div>
      <div className={`${open ? "flex" : "hidden"} min-h-0 flex-1 flex-col md:flex`}>
        <form action={newBrandAction} className="px-3">
          <button className="flex h-9 w-full items-center gap-2 rounded-lg border border-line px-3 text-left font-medium hover:bg-subtle">
            <span aria-hidden className="text-[16px] leading-none text-ink-3">+</span>
            New brand
          </button>
        </form>
        <nav className="mt-4 min-h-0 flex-1 overflow-y-auto px-3" aria-label="Brands">
          <ul className="space-y-0.5">
            {brands.map((b) => {
              const active = params.id === b.id;
              return (
                <li key={b.id}>
                  <Link
                    href={`/brands/${b.id}`}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-lg px-3 py-2 ${active ? "bg-subtle" : "hover:bg-subtle"}`}
                  >
                    <span className="block truncate font-medium">{b.name}</span>
                    <span className="font-mono text-[11px] text-ink-3">{stageLabel(b.stage)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="space-y-1 border-t border-line p-3">
          <Link href="/connect" className="block rounded-lg px-3 py-2 text-[13px] text-ink-2 hover:bg-subtle">
            Use Vybd in Claude or ChatGPT
          </Link>
          {isOperator && (
            <Link href="/ops" className="block rounded-lg px-3 py-2 text-[13px] text-ink-2 hover:bg-subtle">
              Ops console
            </Link>
          )}
          <form action={signOutAction} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="truncate text-[12px] text-ink-3" title={email}>
              {email}
            </span>
            <button className="shrink-0 text-[12px] text-ink-2 hover:text-ink">Sign out</button>
          </form>
        </div>
      </div>
    </aside>
  );
}
