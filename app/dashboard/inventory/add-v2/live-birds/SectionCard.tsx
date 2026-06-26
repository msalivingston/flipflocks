import type { ReactNode } from "react";

export function SectionCard({
  badge,
  children,
  step,
  title,
}: {
  badge?: string;
  children: ReactNode;
  step: string;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-900 sm:size-8">
          {step}
        </span>
        <h2 className="text-base font-semibold text-stone-950 sm:text-lg">
          {title}
        </h2>
        {badge ? (
          <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-sm font-semibold text-stone-600 sm:text-xs">
            {badge}
          </span>
        ) : null}
      </div>
      <div className="mt-3 sm:mt-4">{children}</div>
    </section>
  );
}
