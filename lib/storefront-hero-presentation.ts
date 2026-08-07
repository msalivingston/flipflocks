export type HeroFocalPoint = {
  x: number;
  y: number;
};

export type StorefrontHeroPresentation = {
  desktop: HeroFocalPoint;
  mobile?: HeroFocalPoint;
};

export type StorefrontHeroLayout = "full" | "right";
export type StorefrontHeroViewport = "desktop" | "mobile";

export const DEFAULT_HERO_FOCAL_POINT: HeroFocalPoint = { x: 50, y: 50 };

function clampPercent(value: unknown, fallback: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(100, Math.max(0, Math.round(numeric * 100) / 100));
}

export function normalizeHeroFocalPoint(
  value: Partial<HeroFocalPoint> | null | undefined,
  fallback = DEFAULT_HERO_FOCAL_POINT,
): HeroFocalPoint {
  return {
    x: clampPercent(value?.x, fallback.x),
    y: clampPercent(value?.y, fallback.y),
  };
}

export function normalizeHeroPresentation(
  value: Partial<StorefrontHeroPresentation> | null | undefined,
): StorefrontHeroPresentation {
  const desktop = normalizeHeroFocalPoint(value?.desktop);
  return value?.mobile
    ? { desktop, mobile: normalizeHeroFocalPoint(value.mobile, desktop) }
    : { desktop };
}

export function resolveHeroFocalPoint(
  presentation: Partial<StorefrontHeroPresentation> | null | undefined,
  viewport: StorefrontHeroViewport,
) {
  const normalized = normalizeHeroPresentation(presentation);
  return viewport === "mobile"
    ? normalized.mobile ?? normalized.desktop
    : normalized.desktop;
}

export function getHeroObjectPosition(
  presentation: Partial<StorefrontHeroPresentation> | null | undefined,
  viewport: StorefrontHeroViewport,
) {
  const focalPoint = resolveHeroFocalPoint(presentation, viewport);
  return `${focalPoint.x}% ${focalPoint.y}%`;
}
