import Image from "next/image";
import type { ReactNode } from "react";

export function SidebarCard({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-xl border border-transparent bg-white p-5 shadow-none sm:rounded-lg sm:border-stone-200 sm:shadow-sm">
      <h2 className="text-xl font-bold text-stone-950 sm:text-lg sm:font-semibold">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function SummaryRow({
  glyph,
  label,
  value,
}: {
  glyph: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-stone-100 py-3 last:border-b-0">
      <Image src={glyph} alt="" width={20} height={20} />
      <span className="flex-1 text-base font-medium text-stone-600 sm:text-sm">{label}</span>
      <span className="text-base font-bold text-stone-950 sm:text-sm sm:font-semibold">{value}</span>
    </div>
  );
}
