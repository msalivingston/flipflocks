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
    <section className="rounded-xl border border-transparent bg-white p-4 shadow-none sm:rounded-lg sm:border-stone-200 sm:p-5 sm:shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-base font-bold text-emerald-900 sm:size-8 sm:text-sm">
          {step}
        </span>
        <h2 className="text-xl font-bold text-stone-950 sm:text-lg sm:font-semibold">
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
