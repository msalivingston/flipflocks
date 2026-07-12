import {
  DM_Sans,
  Fraunces,
  Inter,
  Libre_Caslon_Text,
  Lora,
  Montserrat,
  Nunito_Sans,
  Oswald,
  Roboto_Slab,
  Source_Sans_3,
} from "next/font/google";

export const storefrontSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source-sans-3",
  weight: "400",
});

export const storefrontSerif = Libre_Caslon_Text({
  subsets: ["latin"],
  variable: "--font-libre-caslon-text",
  weight: ["400", "700"],
});

const lora = Lora({
  subsets: ["latin"],
  variable: "--font-lora",
  weight: ["400", "700"],
});

const nunitoSans = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-nunito-sans",
  weight: "400",
});

const oswald = Oswald({
  subsets: ["latin"],
  variable: "--font-oswald",
  weight: ["400", "600"],
});

const robotoSlab = Roboto_Slab({
  subsets: ["latin"],
  variable: "--font-roboto-slab",
  weight: ["400", "700"],
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  weight: "400",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: ["400", "700"],
});

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  weight: ["400", "700"],
});

const inter = Inter({
  subsets: ["latin"],
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
