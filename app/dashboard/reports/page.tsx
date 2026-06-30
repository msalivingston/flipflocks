import Image from "next/image";
import { ReportsDashboard } from "./reports-dashboard";

export default function SellerReportsPage() {
  return (
    <>
      <header className="flex flex-col gap-3 border-b border-stone-200 bg-white px-5 py-3.5 sm:px-7 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-stone-950">Reports</h1>
          <p className="mt-0.5 max-w-2xl text-sm leading-5 text-stone-600">
            Review sales, items, and customer activity.
          </p>
        </div>
        <div className="hidden h-16 w-40 shrink-0 overflow-hidden lg:block xl:h-20 xl:w-52">
          <Image
            src="/reports-hen-sketch.png"
            alt=""
            width={260}
            height={159}
            className="h-full w-full object-contain opacity-60"
            priority
          />
        </div>
      </header>
      <div className="mx-auto w-full max-w-7xl px-5 py-4 sm:px-7">
        <ReportsDashboard />
      </div>
    </>
  );
}
