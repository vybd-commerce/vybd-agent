// The Folded V. Two variants only: full color for light grounds, lighter right facets on navy.
export function Mark({ onNavy = false, className = "" }: { onNavy?: boolean; className?: string }) {
  return (
    <svg aria-hidden viewBox="4 4 92 84" className={className}>
      <path d="M4 4 L36 4 L50 46 Z" fill="#5FD6BF" />
      <path d="M4 4 L50 46 L38 88 Z" fill="#1BB59B" />
      <path d="M96 4 L64 4 L50 46 Z" fill={onNavy ? "#3a4a6b" : "#25324d"} />
      <path d="M96 4 L50 46 L62 88 Z" fill={onNavy ? "#25324d" : "#0f1b33"} />
      <path d="M38 88 L50 46 L62 88 Z" fill="#13987F" />
    </svg>
  );
}

/** Mark + "Vybd" in the display serif. Sized by font-size, so text-[..] classes scale both. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[0.41em] font-display text-[22px] leading-none tracking-[-0.015em] text-ink ${className}`}>
      <Mark className="h-[0.95em] w-auto" />
      Vybd
    </span>
  );
}

export function AgentAvatar() {
  return (
    <span aria-hidden className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-ink">
      <Mark onNavy className="h-[13px] w-auto" />
    </span>
  );
}

/** Person avatar: initial on a cool grey disc. */
export function PersonAvatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-selected text-[12px] font-semibold leading-none"
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
