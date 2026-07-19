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
      <div className="grid gap-4">
        <div className="overflow-hidden rounded-lg border border-[#ded7c8]">
          <ListingPhoto alt={fallbackAlt} src={fallbackSrc} />
        </div>
        {fallbackSrc ? (
          <div className="grid grid-cols-4 gap-3">
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
    <StorefrontMediaFrame className="grid gap-4 border-0 bg-transparent p-0">
      <figure className="grid gap-2">
        <div className="overflow-hidden rounded-lg border border-[#ded7c8]">
          <Image
            alt={selectedImage.alt_text || fallbackAlt}
            className={cx(
              "aspect-[4/3] w-full",
              selectedImage.crop_metadata ? "object-contain" : "object-cover",
            )}
            height={720}
            src={toPublicImageUrl(selectedImage.public_url)}
            style={getStorefrontCropStyle(selectedImage.crop_metadata)}
            unoptimized
            width={960}
          />
        </div>
        {selectedImage.caption ? (
          <figcaption className="text-sm leading-6 text-stone-600">
            {selectedImage.caption}
          </figcaption>
        ) : null}
      </figure>
      <div className="grid grid-cols-4 gap-3">
        {thumbnails.map((image, index) => {
          const isSelected = image === selectedImage;

          return (
            <button
              aria-label={`Show photo ${index + 1}`}
              aria-pressed={isSelected}
              className={cx(
                "rounded-md border bg-white p-0.5 transition focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2",
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
    </StorefrontMediaFrame>
  );
}
