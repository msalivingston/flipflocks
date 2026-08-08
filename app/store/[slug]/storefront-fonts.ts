import localFont from "next/font/local";

export const storefrontSans = localFont({
  src: "./fonts/source-sans-3-400.ttf",
  variable: "--font-source-sans-3",
  weight: "400",
});

export const storefrontSerif = localFont({
  src: [
    { path: "./fonts/libre-caslon-text-400.ttf", weight: "400" },
    { path: "./fonts/libre-caslon-text-700.ttf", weight: "700" },
  ],
  variable: "--font-libre-caslon-text",
});

const lora = localFont({
  src: [
    { path: "./fonts/lora-400.ttf", weight: "400" },
    { path: "./fonts/lora-700.ttf", weight: "700" },
  ],
  variable: "--font-lora",
});

const nunitoSans = localFont({
  src: "./fonts/nunito-sans-400.ttf",
  variable: "--font-nunito-sans",
  weight: "400",
});

const oswald = localFont({
  src: [
    { path: "./fonts/oswald-400.ttf", weight: "400" },
    { path: "./fonts/oswald-600.ttf", weight: "600" },
  ],
  variable: "--font-oswald",
});

const robotoSlab = localFont({
  src: [
    { path: "./fonts/roboto-slab-400.ttf", weight: "400" },
    { path: "./fonts/roboto-slab-700.ttf", weight: "700" },
  ],
  variable: "--font-roboto-slab",
});

const dmSans = localFont({
  src: "./fonts/dm-sans-400.ttf",
  variable: "--font-dm-sans",
  weight: "400",
});

const fraunces = localFont({
  src: [
    { path: "./fonts/fraunces-400.ttf", weight: "400" },
    { path: "./fonts/fraunces-700.ttf", weight: "700" },
  ],
  variable: "--font-fraunces",
});

const montserrat = localFont({
  src: [
    { path: "./fonts/montserrat-400.ttf", weight: "400" },
    { path: "./fonts/montserrat-700.ttf", weight: "700" },
  ],
  variable: "--font-montserrat",
});

const inter = localFont({
  src: "./fonts/inter-400.ttf",
  variable: "--font-inter",
  weight: "400",
});

export type StorefrontFontPairId =
  | "farmstead"
  | "homestead"
  | "farm_market"
  | "modern_farm"
  | "friendly_fields"
  | "clean_simple";

export type StorefrontThemeSettings = {
  fontPair: StorefrontFontPairId;
  headingColor: string;
  textColor: string;
  topMenuColor: string;
};

export type StorefrontThemeInput = {
  fontPair?: unknown;
  headingColor?: unknown;
  textColor?: unknown;
  topMenuColor?: unknown;
} | null;

export const defaultStorefrontTheme: StorefrontThemeSettings = {
  fontPair: "farmstead",
  headingColor: "#073f1e",
  textColor: "#1f2f37",
  topMenuColor: "#ffffff",
};

export const storefrontFontPairs: Array<{
  id: StorefrontFontPairId;
  label: string;
  headingFontLabel: string;
  bodyFontLabel: string;
  headingFontVariable: string;
  bodyFontVariable: string;
}> = [
  {
    id: "farmstead",
    label: "Farmstead",
    headingFontLabel: "Libre Caslon Text",
    bodyFontLabel: "Source Sans 3",
    headingFontVariable: "var(--font-libre-caslon-text)",
    bodyFontVariable: "var(--font-source-sans-3)",
  },
  {
    id: "homestead",
    label: "Homestead",
    headingFontLabel: "Lora",
    bodyFontLabel: "Nunito Sans",
    headingFontVariable: "var(--font-lora)",
    bodyFontVariable: "var(--font-nunito-sans)",
  },
  {
    id: "farm_market",
    label: "Farm Market",
    headingFontLabel: "Oswald",
    bodyFontLabel: "Source Sans 3",
    headingFontVariable: "var(--font-oswald)",
    bodyFontVariable: "var(--font-source-sans-3)",
  },
  {
    id: "modern_farm",
    label: "Modern Farm",
    headingFontLabel: "Roboto Slab",
    bodyFontLabel: "DM Sans",
    headingFontVariable: "var(--font-roboto-slab)",
    bodyFontVariable: "var(--font-dm-sans)",
  },
  {
    id: "friendly_fields",
    label: "Friendly Fields",
    headingFontLabel: "Fraunces",
    bodyFontLabel: "Nunito Sans",
    headingFontVariable: "var(--font-fraunces)",
    bodyFontVariable: "var(--font-nunito-sans)",
  },
  {
    id: "clean_simple",
    label: "Clean & Simple",
    headingFontLabel: "Montserrat",
    bodyFontLabel: "Inter",
    headingFontVariable: "var(--font-montserrat)",
    bodyFontVariable: "var(--font-inter)",
  },
];

export const storefrontFontVariablesClass = [
  storefrontSans.variable,
  storefrontSerif.variable,
  lora.variable,
  nunitoSans.variable,
  oswald.variable,
  robotoSlab.variable,
  dmSans.variable,
  fraunces.variable,
  montserrat.variable,
  inter.variable,
].join(" ");

export const storefrontSerifClass = "storefront-heading-font storefront-serif";

export function normalizeStorefrontFontPair(
  value: unknown,
): StorefrontFontPairId {
  return storefrontFontPairs.some((pair) => pair.id === value)
    ? (value as StorefrontFontPairId)
    : defaultStorefrontTheme.fontPair;
}

export function getStorefrontFontPair(id: unknown) {
  const normalizedId = normalizeStorefrontFontPair(id);
  return (
    storefrontFontPairs.find((pair) => pair.id === normalizedId) ??
    storefrontFontPairs[0]
  );
}

export function isValidStorefrontHexColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

export function normalizeStorefrontHexColor(
  value: unknown,
  fallback: string,
) {
  if (typeof value !== "string") return fallback;

  const trimmed = value.trim();
  const normalized = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;

  return isValidStorefrontHexColor(normalized)
    ? normalized.toLowerCase()
    : fallback;
}
