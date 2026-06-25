import { formatDisplayDate } from "./helpers";
import { SidebarCard, SummaryRow } from "./SidebarCard";

export function BatchSummaryCard({
  birdsTotal,
  hatchDate,
  offeringCount,
}: {
  birdsTotal: number;
  hatchDate: string;
  offeringCount: number;
}) {
  return (
    <SidebarCard title="Hatch Summary">
      <SummaryRow
        glyph="/glyphs/calendar.png"
        label="Hatch date"
        value={formatDisplayDate(hatchDate)}
      />
      <SummaryRow
        glyph="/glyphs/hen.png"
        label="Birds for Sale"
        value={String(offeringCount)}
      />
      <SummaryRow
        glyph="/glyphs/customers.png"
        label="Birds total"
        value={String(birdsTotal)}
      />
    </SidebarCard>
  );
}
