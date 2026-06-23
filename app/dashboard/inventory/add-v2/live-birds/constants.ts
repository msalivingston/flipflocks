import type { BirdOffering } from "./types";

export const inputClass =
  "min-h-10 w-full rounded-md border border-stone-200 bg-white px-3 text-sm font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20";

export const disabledButtonClass =
  "inline-flex min-h-10 cursor-not-allowed items-center justify-center rounded-md border border-emerald-800/25 bg-emerald-50/40 px-4 text-sm font-semibold text-emerald-900 opacity-65";

export const mutedTextActionClass =
  "text-xs font-semibold text-stone-400";

export const speciesOptions = [
  "Chickens",
  "Ducks",
  "Geese",
  "Turkeys",
  "Guinea",
  "Quail",
  "Pheasants",
  "Peafowl",
  "Pigeons",
  "Ratites",
];

export const breedOptions = [
  "Ameraucana - Blue",
  "Rhode Island Red",
  "Buff Orpington",
  "Barred Rock",
  "Easter Egger",
];

export const soldAsOptions = ["Female", "Male", "Straight run", "Pair", "Trio"];

export const defaultHatchDate = "2026-06-21";
export const defaultAvailableDate = "2027-01-21";
export const defaultDescription =
  "Gentle, friendly birds known for their blue eggs. Calm temperament and beautiful lavender-blue plumage.";

export const initialOfferings: BirdOffering[] = [
  {
    id: "offering-1",
    breed: "Ameraucana - Blue",
    soldAs: "Female",
    quantity: "10",
    price: "15",
    description: defaultDescription,
    expanded: true,
  },
  {
    id: "offering-2",
    breed: "Rhode Island Red",
    soldAs: "Straight run",
    quantity: "24",
    price: "6",
    description: "Hardy red birds with steady temperament and classic brown egg production.",
    expanded: false,
  },
];
