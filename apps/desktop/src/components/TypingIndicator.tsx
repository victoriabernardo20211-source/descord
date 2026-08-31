import type { JSX } from 'react';
export function TypingIndicator({ names }: { names: string[] }): JSX.Element | null {
  if (names.length === 0) return null;

  const text =
    names.length === 1
      ? `${names[0]} está digitando…`
      : names.length === 2
        ? `${names[0]} e ${names[1]} estão digitando…`
        : 'Várias pessoas estão digitando…';

  return (
    <div className="px-6 pb-1 text-[12px] text-mist-400" aria-live="polite">
      {text}
    </div>
  );
}
