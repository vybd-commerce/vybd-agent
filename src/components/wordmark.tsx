export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`text-[17px] font-semibold tracking-[-0.02em] ${className}`}>vybd</span>;
}

export function AgentAvatar() {
  return (
    <span
      aria-hidden
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-semibold leading-none text-white"
    >
      v
    </span>
  );
}
