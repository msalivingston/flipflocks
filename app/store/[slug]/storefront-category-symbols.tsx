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
  return (
    <svg
      aria-hidden="true"
      className={`${className} shrink-0`}
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      {name === "poultry" ? (
        <circle cx="12" cy="12" r="7.5" />
      ) : null}
      {name === "egg" ? (
        <ellipse cx="12" cy="12" rx="6.4" ry="8" />
      ) : null}
      {name === "equipment" ? (
        <rect height="12" rx="2.5" transform="rotate(45 12 12)" width="12" x="6" y="6" />
      ) : null}
      {name === "processed" ? (
        <rect height="10" rx="5" width="16" x="4" y="7" />
      ) : null}
    </svg>
  );
}
