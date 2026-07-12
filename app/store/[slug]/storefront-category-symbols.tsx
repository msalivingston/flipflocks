import { StorefrontGlyph } from "./storefront-ui";

export type StorefrontCategorySymbolName =
  | "egg"
  | "equipment"
  | "poultry"
  | "processed";

export function StorefrontCategorySymbol({
  className = "h-5 w-5",
  name,
}: {
  className?: string;
  name: StorefrontCategorySymbolName;
}) {
  const src =
    name === "egg"
      ? "/glyphs/egg.png"
      : name === "equipment"
        ? "/glyphs/feed-sack.png"
        : name === "processed"
          ? "/glyphs/chicken-leg.png"
          : "/glyphs/hen.png";

  return (
    <StorefrontGlyph className={className} src={src} />
  );
}
