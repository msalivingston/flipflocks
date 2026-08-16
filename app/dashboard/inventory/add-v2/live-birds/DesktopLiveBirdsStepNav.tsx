type LiveBirdsDesktopStep = 1 | 2 | 3 | 4;

const addSteps: Array<{
  label: string;
  step: LiveBirdsDesktopStep;
}> = [
  { label: "Hatch Details", step: 1 },
  { label: "Birds for Sale", step: 2 },
  { label: "Automatic Price Changes", step: 3 },
  { label: "Ready to Publish", step: 4 },
];

export function DesktopLiveBirdsStepNav({
  activeStep,
  highestUnlockedStep,
  mode = "create",
  onStepSelect,
}: {
  activeStep: LiveBirdsDesktopStep;
  highestUnlockedStep: LiveBirdsDesktopStep;
  mode?: "create" | "edit";
  onStepSelect: (step: LiveBirdsDesktopStep) => void;
}) {
  const steps =
    mode === "edit"
      ? addSteps.map((item) =>
          item.step === 4 ? { ...item, label: "Review & Save" } : item,
        )
      : addSteps;

  return (
    <aside className="hidden sm:block">
      <div className="sticky top-5">
        <nav
          aria-label={mode === "edit" ? "Edit Live Birds sections" : "Add Live Birds steps"}
          className="overflow-hidden rounded-l-lg border border-stone-200 bg-white shadow-sm"
        >
          <ol className="divide-y divide-stone-200">
            {steps.map(({ label, step }) => {
              const active = step === activeStep;
              const complete = step < highestUnlockedStep;
              const disabled = step > highestUnlockedStep;

              return (
                <li key={step}>
                  <button
                    aria-current={active ? "step" : undefined}
                    className={`relative flex min-h-20 w-full items-center gap-3 px-4 py-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-700 disabled:cursor-not-allowed ${
                      active
                        ? "z-10 bg-emerald-50 text-emerald-950 after:absolute after:-right-px after:inset-y-0 after:w-0.5 after:bg-emerald-50"
                        : disabled
                          ? "bg-stone-50/70 text-stone-400"
                          : "bg-white text-stone-800 hover:bg-stone-50"
                    }`}
                    disabled={disabled}
                    type="button"
                    onClick={() => onStepSelect(step)}
                  >
                    {active ? (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-0 left-0 w-1 bg-emerald-700"
                      />
                    ) : null}
                    <span
                      className={`flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${
                        active || complete
                          ? "border-emerald-800 bg-emerald-800 text-white"
                          : disabled
                            ? "border-stone-300 bg-stone-100 text-stone-400"
                            : "border-stone-300 bg-white text-stone-600"
                      }`}
                    >
                      {complete ? (
                        <span aria-label="Complete">&#10003;</span>
                      ) : (
                        step
                      )}
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-bold leading-5">
                      {label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
    </aside>
  );
}
