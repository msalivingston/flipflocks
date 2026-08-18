export type BirdAgeFormatOptions = {
  includeOld?: boolean;
  includeRemainingDays?: boolean;
  minimumDaysForWeeks?: number;
  zeroLabel?: string;
};

const MAX_WEEKS_BEFORE_MONTHS = 26;
const WEEKS_PER_YEAR = 52;
const MONTHS_PER_YEAR = 12;

export function formatBirdAgeInDays(
  days: number | null | undefined,
  {
    includeOld = false,
    includeRemainingDays = false,
    minimumDaysForWeeks = 7,
    zeroLabel,
  }: BirdAgeFormatOptions = {},
) {
  if (days == null || !Number.isFinite(days)) return null;

  const wholeDays = Math.floor(days);

  if (wholeDays < 0) return null;
  if (wholeDays === 0 && zeroLabel) return zeroLabel;

  const weeks = Math.floor(wholeDays / 7);
  const suffix = includeOld ? " old" : "";

  if (weeks > MAX_WEEKS_BEFORE_MONTHS) {
    const months = Math.floor((weeks * MONTHS_PER_YEAR) / WEEKS_PER_YEAR);
    return `${months} month${months === 1 ? "" : "s"}${suffix}`;
  }

  if (wholeDays < minimumDaysForWeeks) {
    return `${wholeDays} day${wholeDays === 1 ? "" : "s"}${suffix}`;
  }

  const weekLabel = `${weeks} week${weeks === 1 ? "" : "s"}`;

  if (!includeRemainingDays) return `${weekLabel}${suffix}`;

  const remainingDays = wholeDays % 7;

  if (remainingDays === 0) return `${weekLabel}${suffix}`;

  return `${weekLabel} + ${remainingDays} day${remainingDays === 1 ? "" : "s"}${suffix}`;
}
