"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import type { StorefrontMedia } from "./storefront-data";
import {
  ListingPhoto,
  StorefrontMediaFrame,
  cx,
  getStorefrontCropStyle,
  toPublicImageUrl,
} from "./storefront-ui";

export function StorefrontProductGallery({
  fallbackAlt,
  fallbackSrc,
  gallery,
}: {
  fallbackAlt: string;
  fallbackSrc: string | null;
  gallery: StorefrontMedia[];
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedImage = gallery[selectedIndex] ?? gallery[0] ?? null;
  const thumbnails = useMemo(
    () => (gallery.length > 0 ? gallery.slice(0, 4) : []),
    [gallery],
  );

  if (!selectedImage) {
    return (
      <div className="grid gap-2 lg:gap-4">
        <div className="overflow-hidden rounded-lg border border-[#e8dfd1] shadow-[0_1px_8px_rgba(41,37,36,0.05)] lg:border-[#ded7c8] lg:shadow-none">
          <div className="lg:hidden">
            <ListingPhoto alt={fallbackAlt} aspect="square" src={fallbackSrc} />
          </div>
          <div className="hidden lg:block">
            <ListingPhoto alt={fallbackAlt} src={fallbackSrc} />
          </div>
        </div>
        {fallbackSrc ? (
          <div className="hidden grid-cols-4 gap-3 lg:grid">
            <Image
              alt={fallbackAlt}
              className="aspect-square w-full rounded-md border border-[#ded7c8] object-cover"
              height={240}
              src={toPublicImageUrl(fallbackSrc)}
              unoptimized
              width={320}
            />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <StorefrontMediaFrame className="grid gap-2 border-0 bg-transparent p-0 lg:gap-4">
      <figure className="grid gap-2">
        <div className="relative overflow-hidden rounded-lg border border-[#e8dfd1] shadow-[0_1px_8px_rgba(41,37,36,0.05)] lg:border-[#ded7c8] lg:shadow-none">
          <Image
            alt={selectedImage.alt_text || fallbackAlt}
            className={cx(
              "aspect-square w-full lg:aspect-[4/3]",
              selectedImage.crop_metadata ? "object-contain" : "object-cover",
            )}
            height={720}
            src={toPublicImageUrl(selectedImage.public_url)}
            style={getStorefrontCropStyle(selectedImage.crop_metadata)}
            unoptimized
            width={960}
          />
          {gallery.length > 1 ? (
            <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2.5 py-1 text-[0.72rem] font-bold text-stone-950 shadow-sm lg:hidden">
              {selectedIndex + 1} / {gallery.length}
            </span>
          ) : null}
        </div>
        {selectedImage.caption ? (
          <figcaption className="hidden text-sm leading-6 text-stone-600 lg:block">
            {selectedImage.caption}
          </figcaption>
        ) : null}
      </figure>
      {thumbnails.length > 0 ? (
      <div
        className={cx(
          "justify-center gap-2 lg:grid lg:grid-cols-4 lg:gap-3",
          thumbnails.length > 1 ? "flex" : "hidden lg:grid",
        )}
      >
        {thumbnails.map((image, index) => {
          const isSelected = image === selectedImage;

          return (
            <button
              aria-label={`Show photo ${index + 1}`}
              aria-pressed={isSelected}
              className={cx(
                "w-16 rounded-md border bg-white p-0.5 transition focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 lg:w-auto",
                isSelected
                  ? "border-emerald-800 ring-2 ring-emerald-700 ring-offset-2"
                  : "border-[#ded7c8] hover:border-emerald-700",
              )}
              key={`${image.entity_type}-${image.entity_id}-${image.public_url}`}
              onClick={() => setSelectedIndex(index)}
              type="button"
            >
              <Image
                alt={image.alt_text || fallbackAlt}
                className={cx(
                  "aspect-square w-full rounded-[3px]",
                  image.crop_metadata ? "object-contain" : "object-cover",
                )}
                height={240}
                src={toPublicImageUrl(image.public_url)}
                style={getStorefrontCropStyle(image.crop_metadata)}
                unoptimized
                width={320}
              />
            </button>
          );
        })}
      </div>
      ) : null}
    </StorefrontMediaFrame>
  );
}
