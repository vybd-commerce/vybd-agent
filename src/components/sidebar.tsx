"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { newBrandAction, signOutAction } from "@/app/actions";
import { STAGES, type Stage } from "@/lib/types";
import { PersonAvatar, Wordmark } from "./wordmark";

type BrandItem = { id: string; name: string; stage: Stage; shared: boolean };

export function Sidebar({
  brands,
  name,
  email,
  isOperator,
}: {
  brands: BrandItem[];
  name: string;
  email: string;
  isOperator: boolean;
}) {
  const params = useParams<{ id?: string }>();
  const [open, setOpen] = useState(false);
  const stageLabel = (s: Stage) => STAGES.find((x) => x.key === s)?.label;

  return (
    <aside className="shrink-0 border-b border-line bg-sidebar px-3.5 md:flex md:h-full md:w-[220px] md:flex-col md:border-r md:border-b-0 md:py-5">
      <div className="flex h-14 items-center justify-between px-1.5 md:h-auto">
        <Link href="/" className="hover:text-ink">
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
      <div className={`${open ? "flex" : "hidden"} min-h-0 flex-1 flex-col gap-[22px] pb-4 md:mt-[22px] md:flex md:pb-0`}>
        <form action={newBrandAction}>
          <button className="flex min-h-10 w-full items-center gap-2 rounded-[10px] border border-line-strong bg-bg px-3 text-left font-medium hover:text-accent-text">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            New brand
          </button>
        </form>
        <nav className="min-h-0 flex-1 overflow-y-auto" aria-label="Your brands">
          <p className="px-2 pb-1.5 text-[12px] text-ink-3">Your brands</p>
          <ul className="flex flex-col gap-0.5">
            {brands.map((b) => {
              const active = params.id === b.id;
              return (
                <li key={b.id}>
                  <Link
                    href={`/brands/${b.id}`}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`flex flex-col rounded-lg px-2.5 py-2 hover:text-ink ${active ? "bg-selected" : "hover:bg-selected/60"}`}
                  >
                    <span className="truncate font-medium">{b.name}</span>
                    <span className={`text-[12px] ${active ? "text-ink-2" : "text-ink-3"}`}>{b.shared ? `Shared · ${stageLabel(b.stage)}` : stageLabel(b.stage)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex flex-col gap-2.5 px-1.5">
          <Link href="/connect" className="text-[12px] text-ink-2">
            Use Vybd in Claude or ChatGPT
          </Link>
          {isOperator && (
            <Link href="/ops" className="text-[12px] text-ink-2">
              Ops console
            </Link>
          )}
          <form action={signOutAction} className="group flex items-center gap-2.5">
            <PersonAvatar name={name || email} />
            <span className="min-w-0 flex-1 truncate text-[13px]" title={email}>
              {name || email}
            </span>
            <button className="shrink-0 text-[12px] text-ink-3 hover:text-ink md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
