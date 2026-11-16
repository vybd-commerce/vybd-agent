"use client";

import { useState } from "react";

/** A command or URL in a code box with a Copy button. */
export function CopyCommand({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-start gap-2 rounded-lg bg-subtle px-3 py-2">
      <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-[13px] whitespace-pre">{text}</pre>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="shrink-0 text-[12px] font-medium text-accent-text hover:underline"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
