import Image from "next/image";

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
    <Image
      alt=""
      aria-hidden="true"
      className={`${className} shrink-0 object-contain`}
      height={128}
      src={src}
      unoptimized
      width={128}
    />
  );
}
