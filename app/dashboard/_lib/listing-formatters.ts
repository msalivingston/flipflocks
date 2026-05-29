export function calculateAgeAtAvailabilityDays(
  originDate: string,
  availableDate: string,
) {
  if (!originDate || !availableDate) return null;

  const originTime = Date.parse(`${originDate}T00:00:00Z`);
  const availableTime = Date.parse(`${availableDate}T00:00:00Z`);

  if (Number.isNaN(originTime) || Number.isNaN(availableTime)) return null;

  return Math.round((availableTime - originTime) / 86_400_000);
}

export function formatAgeAtAvailability(days: number | null | undefined) {
  if (days == null) return "Not set";
  if (days < 0) return "Available date is before hatch date";
  if (days < 7) return `${days} day${days === 1 ? "" : "s"}`;

  const weeks = Math.floor(days / 7);
  const remainder = days % 7;

  if (remainder === 0) return `${weeks} week${weeks === 1 ? "" : "s"}`;

  return `${weeks} week${weeks === 1 ? "" : "s"}, ${remainder} day${
    remainder === 1 ? "" : "s"
  }`;
}

export function formatInventoryTypeLabel(value: string | null | undefined) {
  if (value === "female") return "Female";
  if (value === "male") return "Male";
  if (value === "straight_run") return "Straight run";
  if (value === "unsexed") return "Unsexed";
  if (value === "pair") return "Pair";
  if (value === "trio") return "Trio";
  if (value === "hatching_eggs") return "Hatching eggs";
  if (value === "other") return "Other";

  return value ? value.replaceAll("_", " ") : "Not set";
}
