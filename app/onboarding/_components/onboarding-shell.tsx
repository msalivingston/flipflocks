import Image from "next/image";
import Link from "next/link";

const totalSteps = 6;

type OnboardingShellProps = {
  children: React.ReactNode;
  currentStep: number;
  headline?: string;
  subhead?: string;
  body?: string;
  compactOnMobile?: boolean;
  reassurance?: string;
};

export function OnboardingShell({
  children,
  currentStep,
  headline = "Let's get started",
  subhead = "Start your farm store",
  body = "We'll walk you through a few simple steps to set up your storefront.",
  compactOnMobile = false,
  reassurance,
}: OnboardingShellProps) {
  return (
    <main className="min-h-screen bg-[#fffaf1] text-[#10281c]">
      <div
        className={`mx-auto flex w-full max-w-[1120px] flex-col px-4 sm:px-6 lg:px-6 lg:pb-2 lg:pt-3 ${
          compactOnMobile ? "py-3 lg:py-3" : "py-2.5 sm:py-3"
        }`}
      >
        <header
          className={
            compactOnMobile
              ? "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2.5 pb-3 lg:flex lg:justify-between lg:gap-4 lg:pb-2"
              : "flex items-center justify-between gap-4 pb-2"
          }
        >
          <Link
            href="/"
            className="inline-flex min-w-0 items-center rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-[#1f6f38] focus:ring-offset-4 focus:ring-offset-[#fffaf1]"
          >
            <Image
              src="/branding/flockfront-logo-final.png"
              alt="FlockFront"
              width={178}
              height={60}
              priority
              className={`h-auto mix-blend-multiply ${
                compactOnMobile ? "w-[154px] lg:w-[208px]" : "w-[178px] sm:w-[208px]"
              }`}
            />
          </Link>

          {compactOnMobile ? (
            <>
              <p
                aria-label={`Step ${currentStep} of ${totalSteps}`}
                className="shrink-0 text-sm font-bold text-stone-800 lg:hidden"
              >
                Step {currentStep} of {totalSteps}
              </p>
              <div
                aria-hidden="true"
                className="col-span-2 h-1.5 overflow-hidden rounded-full bg-stone-200 lg:hidden"
              >
                <div
                  className="h-full rounded-full bg-[#246f38]"
                  style={{ width: `${(currentStep / totalSteps) * 100}%` }}
                />
              </div>
              <DesktopStepIndicator currentStep={currentStep} />
            </>
          ) : (
            <StepIndicator currentStep={currentStep} />
          )}
        </header>

        <section
          className={`relative grid ${
            compactOnMobile
              ? "gap-3 overflow-visible lg:min-h-[480px] lg:grid-cols-[0.72fr_1fr] lg:gap-0 lg:overflow-hidden lg:rounded-[0.95rem] lg:border lg:border-[#e8deca] lg:bg-[#f8edda] lg:shadow-[0_10px_28px_rgba(66,49,24,0.09)]"
              : "overflow-hidden rounded-[0.95rem] border border-[#e8deca] bg-[#f8edda] shadow-[0_10px_28px_rgba(66,49,24,0.09)] lg:min-h-[480px] lg:grid-cols-[0.72fr_1fr]"
          }`}
        >
          <div
            aria-hidden="true"
            className={`absolute inset-y-0 left-0 w-full overflow-hidden [mask-image:linear-gradient(to_right,#000_0%,#000_68%,rgba(0,0,0,0.45)_86%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_right,#000_0%,#000_68%,rgba(0,0,0,0.45)_86%,transparent_100%)] lg:w-[50%] lg:[mask-image:linear-gradient(to_right,#000_0%,#000_70%,rgba(0,0,0,0.55)_84%,rgba(0,0,0,0.18)_94%,transparent_100%)] lg:[-webkit-mask-image:linear-gradient(to_right,#000_0%,#000_70%,rgba(0,0,0,0.55)_84%,rgba(0,0,0,0.18)_94%,transparent_100%)] ${
              compactOnMobile ? "hidden lg:block" : ""
            }`}
          >
            <Image
              src="/onboarding/farm-chickens-golden-hour.png"
              alt=""
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 72vw"
              className="-scale-x-100 object-cover object-[center_78%] lg:object-[center_82%]"
            />
            <div className="absolute inset-0 bg-linear-to-b from-[#fff9ed]/58 via-[#fff7e7]/12 to-[#261807]/2" />
          </div>

          <div
            className={`relative ${
              compactOnMobile
                ? "min-h-0 overflow-visible lg:min-h-full lg:overflow-hidden"
                : "min-h-[285px] overflow-hidden lg:min-h-full"
            }`}
          >
            <div
              className={`relative z-10 flex h-full flex-col justify-start ${
                compactOnMobile
                  ? "px-1 py-3 lg:px-9 lg:py-8"
                  : "px-6 py-6 sm:px-9 sm:py-8 lg:px-9 lg:py-8"
              }`}
            >
              <h1
                className={`max-w-xl font-serif font-semibold text-[#0c2118] ${
                  compactOnMobile
                    ? "text-[2rem] leading-[1.02] lg:text-[clamp(1.95rem,3vw,2.85rem)] lg:leading-[1.03]"
                    : "text-[clamp(1.95rem,3vw,2.85rem)] leading-[1.03]"
                }`}
              >
                {headline}
              </h1>
              <p
                className={`font-bold leading-tight text-[#28713a] ${
                  compactOnMobile
                    ? "mt-2 text-[1.05rem] lg:mt-2.5 lg:text-[clamp(1.05rem,1.55vw,1.35rem)]"
                    : "mt-2.5 text-[clamp(1.05rem,1.55vw,1.35rem)]"
                }`}
              >
                {subhead}
              </p>
              <p
                className={`max-w-sm font-normal text-stone-950 ${
                  compactOnMobile
                    ? "mt-2 text-base leading-6 lg:mt-2.5 lg:leading-7"
                    : "mt-2.5 text-base leading-7"
                }`}
              >
                {body}
              </p>
              {compactOnMobile && reassurance ? (
                <p className="mt-2.5 inline-flex w-fit items-center gap-2 text-sm font-bold text-[#246f38] lg:hidden">
                  <span
                    aria-hidden="true"
                    className="inline-flex size-5 items-center justify-center rounded-full bg-[#dcefdc] text-xs"
                  >
                    &#10003;
                  </span>
                  {reassurance}
                </p>
              ) : null}
            </div>
          </div>

          <div
            className={`relative z-10 flex justify-center ${
              compactOnMobile
                ? "items-start px-0 py-0 lg:items-center lg:px-5 lg:py-6"
                : "items-center px-5 py-5 sm:px-7 sm:py-6 lg:px-5 lg:py-6"
            }`}
          >
            <div className="onboarding-card-transition w-full max-w-[550px]">
              {children}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div
      aria-label={`Step ${currentStep} of ${totalSteps}`}
      className="flex shrink-0 items-center gap-2 text-sm font-semibold text-stone-800"
    >
      <span>
        Step {currentStep} of {totalSteps}
      </span>
      <StepDots currentStep={currentStep} />
    </div>
  );
}

function DesktopStepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="hidden lg:flex">
      <StepIndicator currentStep={currentStep} />
    </div>
  );
}

function StepDots({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      {Array.from({ length: totalSteps }, (_, index) => {
        const dotStep = index + 1;
        return (
          <span
            key={dotStep}
            className={`size-2.5 rounded-full border ${
              dotStep === currentStep
                ? "border-[#1f6f38] bg-[#1f6f38]"
                : dotStep < currentStep
                  ? "border-[#1f6f38] bg-[#1f6f38]/75"
                  : "border-stone-300 bg-white"
            }`}
          />
        );
      })}
    </div>
  );
}
