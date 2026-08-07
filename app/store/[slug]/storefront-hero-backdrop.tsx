import Image from "next/image";
import {
  getHeroObjectPosition,
  type StorefrontHeroLayout,
  type StorefrontHeroPresentation,
  type StorefrontHeroViewport,
} from "@/lib/storefront-hero-presentation";
import { toPublicImageUrl } from "./storefront-ui";

export function StorefrontHeroBackdrop({
  alt,
  layout,
  presentation,
  src,
  viewport = "responsive",
}: {
  alt: string;
  layout: StorefrontHeroLayout;
  presentation: StorefrontHeroPresentation | null | undefined;
  src: string | null;
  viewport?: StorefrontHeroViewport | "responsive";
}) {
  if (!src) {
    return (
      <div className="absolute inset-0 overflow-hidden bg-[linear-gradient(135deg,#f6ead8_0%,#d9e6cf_45%,#8fae72_100%)]">
        <div className="absolute inset-x-0 bottom-0 h-28 bg-[linear-gradient(180deg,transparent,#5e7d3d)] opacity-45" />
        <div className="absolute bottom-0 left-[46%] h-24 w-44 rounded-t-lg bg-[#8d3f20] shadow-[22px_-42px_0_-18px_#7d341c,140px_-34px_0_-14px_#f4dfbf]" />
        <div className="absolute bottom-0 right-[8%] h-32 w-20 rounded-t-full bg-[#d8c9aa] shadow-[-34px_4px_0_-8px_#c6b796]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_20%,rgba(255,255,255,0.7),transparent_26%),linear-gradient(90deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0.22)_38%,rgba(255,255,255,0)_66%)]" />
      </div>
    );
  }

  const imageUrl = toPublicImageUrl(src);
  const showMobile = viewport !== "desktop";
  const showDesktop = viewport !== "mobile";

  return (
    <>
      {layout === "right" ? (
        <Image
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl saturate-110 lg:inset-x-auto lg:left-1/2 lg:w-[min(100%,93.75rem)] lg:-translate-x-1/2"
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 70rem"
          src={imageUrl}
          style={{ filter: "blur(26px) brightness(0.62) saturate(1.12)" }}
          unoptimized
        />
      ) : null}
      {showMobile ? (
        <Image
          alt={alt}
          className={`${viewport === "responsive" ? "lg:hidden" : ""} absolute inset-0 h-full w-full object-cover`}
          fill
          priority
          sizes="100vw"
          src={imageUrl}
          style={{ objectPosition: getHeroObjectPosition(presentation, "mobile") }}
          unoptimized
        />
      ) : null}
      {showDesktop ? (
        <Image
          alt={alt}
          className={`${viewport === "responsive" ? "hidden lg:block" : ""} absolute inset-0 h-full w-full object-cover`}
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 70rem"
          src={imageUrl}
          style={{
            objectPosition: getHeroObjectPosition(presentation, "desktop"),
            ...(layout === "right"
              ? {
                  WebkitMaskImage:
                    "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.2) 18%, black 34%, black 100%)",
                  maskImage:
                    "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.2) 18%, black 34%, black 100%)",
                }
              : {}),
          }}
          unoptimized
        />
      ) : null}
      <div
        className={`${viewport === "responsive" ? "lg:hidden" : viewport === "desktop" ? "hidden" : ""} pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(90deg,rgba(28,25,23,0.8)_0%,rgba(28,25,23,0.64)_42%,rgba(28,25,23,0.3)_74%,rgba(28,25,23,0.08)_100%)]`}
      />
      {layout === "right" ? (
        <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(90deg,rgba(28,25,23,0.46)_0%,rgba(28,25,23,0.34)_36%,rgba(28,25,23,0.04)_72%)]" />
      ) : null}
    </>
  );
}
