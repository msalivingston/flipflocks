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
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-stone-950">{title}</h2>
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
      <span className="flex-1 text-sm text-stone-600">{label}</span>
      <span className="text-sm font-semibold text-stone-950">{value}</span>
    </div>
  );
}
