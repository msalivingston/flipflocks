import type { ReactNode } from "react";

export function SectionCard({
  badge,
  children,
  className = "",
  mobileComplete = false,
  mobileArtwork,
  mobileExpanded,
  mobileSummary,
  onMobileToggle,
  step,
  title,
}: {
  badge?: string;
  children: ReactNode;
  className?: string;
  mobileComplete?: boolean;
  mobileArtwork?: ReactNode;
  mobileExpanded?: boolean;
  mobileSummary?: ReactNode;
  onMobileToggle?: () => void;
  step: string;
  title: string;
}) {
  const hasMobileDisclosure = typeof mobileExpanded === "boolean";

  return (
    <section
      className={`rounded-2xl border border-stone-200 bg-white shadow-none transition-all duration-200 sm:rounded-lg sm:p-5 sm:shadow-sm ${
        hasMobileDisclosure && !mobileExpanded ? "p-3.5" : "p-5"
      } ${className}`}
    >
      <button
        aria-expanded={hasMobileDisclosure ? mobileExpanded : undefined}
        className={`flex w-full flex-wrap items-center gap-3 text-left sm:pointer-events-none ${
          hasMobileDisclosure ? "" : "pointer-events-none"
        }`}
        disabled={!hasMobileDisclosure}
        type="button"
        onClick={onMobileToggle}
      >
        {mobileArtwork ? (
          <span
            className={`transition-transform duration-200 sm:hidden ${
              mobileExpanded ? "" : "scale-75"
            }`}
          >
            {mobileArtwork}
          </span>
        ) : null}
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-base font-bold text-emerald-900 max-sm:bg-emerald-800 max-sm:text-white sm:size-8 sm:text-sm">
          {mobileComplete ? (
            <span
              aria-label="Complete"
              className="animate-[live-birds-check_240ms_ease-out] text-lg"
            >
              ✓
            </span>
          ) : (
            step
          )}
        </span>
        <h2 className="min-w-0 flex-1 text-xl font-bold text-stone-950 sm:flex-none sm:text-lg sm:font-semibold">
          {title}
        </h2>
        {badge ? (
          <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-sm font-semibold text-stone-600 sm:text-xs">
            {badge}
          </span>
        ) : null}
        {hasMobileDisclosure ? (
          <span
            aria-hidden="true"
            className={`ml-auto h-2.5 w-2.5 shrink-0 border-b-2 border-r-2 border-emerald-800/80 transition-transform sm:hidden ${
              mobileExpanded ? "rotate-45" : "-rotate-45"
            }`}
          />
        ) : null}
      </button>
      {!mobileExpanded && mobileSummary ? (
        <div className="mt-1 pl-11 text-sm font-medium leading-5 text-stone-600 sm:hidden">
          {mobileSummary}
        </div>
      ) : null}
      <div
        className={`mt-3 sm:mt-4 ${
          hasMobileDisclosure && !mobileExpanded ? "hidden sm:block" : ""
        }`}
      >
        {children}
      </div>
    </section>
  );
}
