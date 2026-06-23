import Image from "next/image";
import Link from "next/link";
import {
  DashboardPageContent,
  SellerPageHeader,
} from "../../_components/seller-ui";

type InventoryOption = {
  title: string;
  description: string;
  glyph: string;
  href?: string;
};

const inventoryOptions: InventoryOption[] = [
  {
    title: "Live Birds",
    description: "Start the new inventory flow for birds available now or soon.",
    glyph: "/glyphs/hen.png",
    href: "/dashboard/inventory/add-v2/live-birds",
  },
  {
    title: "Hatching Eggs",
    description: "Create egg inventory for pickup or shipping once v2 is ready.",
    glyph: "/glyphs/egg-carton.png",
  },
  {
    title: "Processed Poultry",
    description: "Add local pickup poultry products in a future v2 flow.",
    glyph: "/glyphs/chicken-leg.png",
  },
  {
    title: "Equipment & Supplies",
    description: "List brooders, incubators, feed, and supplies later.",
    glyph: "/glyphs/feed-sack.png",
  },
];

export default function AddInventoryV2Page() {
  return (
    <>
      <SellerPageHeader
        title="Add Inventory"
        description="Choose what you want to add to your storefront."
      />
      <DashboardPageContent>
        <div className="grid max-w-5xl gap-4 md:grid-cols-2">
          {inventoryOptions.map((option) => (
            <InventoryOptionCard key={option.title} option={option} />
          ))}
        </div>
      </DashboardPageContent>
    </>
  );
}

function InventoryOptionCard({ option }: { option: InventoryOption }) {
  const cardContent = (
    <>
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-emerald-100 bg-emerald-50">
        <Image src={option.glyph} alt="" width={36} height={36} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-stone-950">
            {option.title}
          </h2>
          {option.href ? null : (
            <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-600">
              Coming soon
            </span>
          )}
        </div>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          {option.description}
        </p>
      </div>
    </>
  );

  const className =
    "flex min-h-40 gap-4 rounded-lg border border-stone-200 bg-white p-5 text-left shadow-sm transition";

  if (option.href) {
    return (
      <Link
        className={`${className} hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2`}
        href={option.href}
      >
        {cardContent}
      </Link>
    );
  }

  return (
    <div
      aria-disabled="true"
      className={`${className} cursor-not-allowed opacity-70`}
    >
      {cardContent}
    </div>
  );
}
