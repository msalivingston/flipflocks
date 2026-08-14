import type { ReactNode } from "react";

export function SectionCard({
  badge,
  children,
  className = "",
  desktopCollapsible = true,
  desktopComplete = false,
  desktopDisabled = false,
  desktopExpanded,
  desktopHeaderArtwork,
  desktopPanelMode = false,
  desktopSummary,
  mobileComplete = false,
  mobileArtwork,
  mobileExpanded,
  mobileSummary,
  onMobileToggle,
  onDesktopToggle,
  step,
  title,
}: {
  badge?: string;
  children: ReactNode;
  className?: string;
  desktopCollapsible?: boolean;
  desktopComplete?: boolean;
  desktopDisabled?: boolean;
  desktopExpanded?: boolean;
  desktopHeaderArtwork?: ReactNode;
  desktopPanelMode?: boolean;
  desktopSummary?: ReactNode;
  mobileComplete?: boolean;
  mobileArtwork?: ReactNode;
  mobileExpanded?: boolean;
  mobileSummary?: ReactNode;
  onMobileToggle?: () => void;
  onDesktopToggle?: () => void;
  step: string;
  title: string;
}) {
  const hasMobileDisclosure = typeof mobileExpanded === "boolean";
  const hasDesktopDisclosure = typeof desktopExpanded === "boolean";
  const desktopHeaderContent = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-base font-bold text-emerald-900">
        {step}
      </span>
      <h2 className="min-w-0 text-xl font-bold text-stone-950">{title}</h2>
      {desktopHeaderArtwork}
      {badge ? (
        <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-semibold text-stone-600">
          {badge}
        </span>
      ) : null}
      <span className="ml-auto inline-flex items-center gap-6">
        {desktopComplete ? (
          <span className="inline-flex items-center gap-2 text-sm font-bold text-emerald-800">
            <span aria-hidden="true">✓</span>
            Complete
          </span>
        ) : null}
        {desktopCollapsible && !desktopDisabled && !desktopPanelMode ? (
          <>
            <span className="text-sm font-bold text-emerald-800">
              {desktopExpanded ? "Collapse" : "Edit"}
            </span>
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 border-b-2 border-r-2 border-emerald-800 transition-transform ${
                desktopExpanded ? "rotate-45" : "-rotate-45"
              }`}
            />
          </>
        ) : null}
      </span>
    </>
  );

  return (
    <section
      className={`rounded-2xl border border-stone-200 bg-white shadow-none transition-all duration-200 sm:rounded-lg sm:p-5 sm:shadow-sm ${
        hasMobileDisclosure && !mobileExpanded ? "p-3.5" : "p-5"
      } ${
        desktopDisabled
          ? "sm:border-stone-200 sm:bg-stone-50/70 sm:opacity-60 sm:shadow-none"
          : ""
      } ${
        desktopPanelMode ? "sm:rounded-l-none" : ""
      } ${desktopPanelMode && !desktopExpanded ? "sm:hidden" : ""} ${className}`}
    >
      <button
        aria-expanded={hasMobileDisclosure ? mobileExpanded : undefined}
        className={`flex w-full flex-wrap items-center gap-3 text-left ${
          hasDesktopDisclosure ? "sm:hidden" : "sm:pointer-events-none"
        } ${hasMobileDisclosure ? "" : "pointer-events-none"}`}
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
      {hasDesktopDisclosure && desktopCollapsible && !desktopPanelMode ? (
        <button
          aria-expanded={desktopExpanded}
          className="hidden min-h-12 w-full items-center gap-4 text-left sm:flex sm:disabled:cursor-not-allowed"
          disabled={desktopDisabled}
          type="button"
          onClick={onDesktopToggle}
        >
          {desktopHeaderContent}
        </button>
      ) : null}
      {hasDesktopDisclosure && (!desktopCollapsible || desktopPanelMode) ? (
        <div className="hidden min-h-12 w-full items-center gap-4 sm:flex">
          {desktopHeaderContent}
        </div>
      ) : null}
      {!mobileExpanded && mobileSummary ? (
        <div className="mt-1 pl-11 text-sm font-medium leading-5 text-stone-600 sm:hidden">
          {mobileSummary}
        </div>
      ) : null}
      {hasDesktopDisclosure && !desktopExpanded && desktopSummary && !desktopPanelMode ? (
        <div className="mt-1 hidden pl-14 text-sm font-medium leading-5 text-stone-600 sm:block">
          {desktopSummary}
        </div>
      ) : null}
      <div
        className={`mt-3 sm:mt-4 ${
          hasMobileDisclosure && !mobileExpanded ? "hidden sm:block" : ""
        } ${
          hasDesktopDisclosure && !desktopExpanded && !desktopPanelMode
            ? "sm:hidden"
            : ""
        }`}
      >
        {children}
      </div>
    </section>
  );
}
