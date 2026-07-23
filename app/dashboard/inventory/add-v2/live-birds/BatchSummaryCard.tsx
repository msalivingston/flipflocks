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
    <SidebarCard title="Listing summary">
      <SummaryRow
        glyph="/glyphs/calendar.png"
        label="Hatch date"
        value={formatDisplayDate(hatchDate)}
      />
      <SummaryRow
        glyph="/glyphs/hen.png"
        label="Bird entries"
        value={String(offeringCount)}
      />
      <SummaryRow
        glyph="/glyphs/customers.png"
        label="Total birds available"
        value={String(birdsTotal)}
      />
    </SidebarCard>
  );
}
