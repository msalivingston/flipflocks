import type { BirdOffering, BreedOption, SpeciesOption } from "./types";

export const inputClass =
  "min-h-10 w-full rounded-md border border-stone-200 bg-white px-3 text-sm font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20";

export const disabledButtonClass =
  "inline-flex min-h-10 cursor-not-allowed items-center justify-center rounded-md border border-emerald-800/25 bg-emerald-50/40 px-4 text-sm font-semibold text-emerald-900 opacity-65";

export const mutedTextActionClass =
  "text-xs font-semibold text-stone-400";

export const liveBirdsV2DraftMarker = "__add_inventory_v2_live_birds__";

export const supportedSpeciesSlugs = [
  "chicken",
  "duck",
  "goose",
  "turkey",
  "guinea-fowl",
  "quail",
  "pheasant",
  "peafowl",
  "pigeons-doves",
  "emus-ostriches-rheas",
];

export const fallbackSpeciesOptions: SpeciesOption[] = [
  { id: null, label: "Chickens", slug: "chicken" },
  { id: null, label: "Ducks", slug: "duck" },
  { id: null, label: "Geese", slug: "goose" },
  { id: null, label: "Turkeys", slug: "turkey" },
  { id: null, label: "Guinea", slug: "guinea-fowl" },
  { id: null, label: "Quail", slug: "quail" },
  { id: null, label: "Pheasants", slug: "pheasant" },
  { id: null, label: "Peafowl", slug: "peafowl" },
  { id: null, label: "Pigeons", slug: "pigeons-doves" },
  { id: null, label: "Ratites", slug: "emus-ostriches-rheas" },
];

export const fallbackBreedOptions: BreedOption[] = [
  {
    id: null,
    label: "Ameraucana - Blue",
    speciesId: null,
    breedId: null,
    catalogImageUrl: null,
    catalogDescription: null,
    sellerPhotoUrl: null,
    sellerDescription: null,
    source: "fallback",
  },
  {
    id: null,
    label: "Rhode Island Red",
    speciesId: null,
    breedId: null,
    catalogImageUrl: null,
    catalogDescription: null,
    sellerPhotoUrl: null,
    sellerDescription: null,
    source: "fallback",
  },
  {
    id: null,
    label: "Buff Orpington",
    speciesId: null,
    breedId: null,
    catalogImageUrl: null,
    catalogDescription: null,
    sellerPhotoUrl: null,
    sellerDescription: null,
    source: "fallback",
  },
  {
    id: null,
    label: "Barred Rock",
    speciesId: null,
    breedId: null,
    catalogImageUrl: null,
    catalogDescription: null,
    sellerPhotoUrl: null,
    sellerDescription: null,
    source: "fallback",
  },
  {
    id: null,
    label: "Easter Egger",
    speciesId: null,
    breedId: null,
    catalogImageUrl: null,
    catalogDescription: null,
    sellerPhotoUrl: null,
    sellerDescription: null,
    source: "fallback",
  },
];

export const soldAsOptions = ["Female", "Male", "Straight run", "Pair", "Trio"];

export const defaultHatchDate = "2026-06-21";
export const defaultAvailableDate = "2027-01-21";

export const initialOfferings: BirdOffering[] = [
  {
    id: "offering-1",
    sellerBreedProfileId: null,
    breedId: null,
    breed: "Ameraucana - Blue",
    soldAs: "Female",
    quantity: "10",
    price: "15",
    description: "",
    expanded: true,
  },
  {
    id: "offering-2",
    sellerBreedProfileId: null,
    breedId: null,
    breed: "Rhode Island Red",
    soldAs: "Straight run",
    quantity: "24",
    price: "6",
    description: "",
    expanded: false,
  },
];
