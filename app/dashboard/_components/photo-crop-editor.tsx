"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export type PhotoCropMetadata = {
  aspect: number;
  x: number;
  y: number;
  zoom: number;
  rotation: 0 | 90 | 180 | 270;
};

export type EditableCropPhoto = {
  altText?: string | null;
  cropMetadata?: PhotoCropMetadata | null;
  label: string;
  url: string;
};

const defaultCrop: PhotoCropMetadata = {
  aspect: 4 / 3,
  x: 0,
  y: 0,
  zoom: 1,
  rotation: 0,
};

export function PhotoCropEditor({
  isSaving = false,
  onCancel,
  onReset,
  onSave,
  photo,
}: {
  isSaving?: boolean;
  onCancel: () => void;
  onReset: () => void;
  onSave: (crop: PhotoCropMetadata) => void;
  photo: EditableCropPhoto;
}) {
  const [crop, setCrop] = useState<PhotoCropMetadata>(
    normalizeCrop(photo.cropMetadata),
  );
  const dragStartRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  function updateCrop(updates: Partial<PhotoCropMetadata>) {
    setCrop((current) => ({ ...current, ...updates }));
  }

  function beginDrag(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: crop.x,
      y: crop.y,
    };
  }

  function moveImage(event: React.PointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;

    updateCrop({
      x: Math.round(start.x + event.clientX - start.startX),
      y: Math.round(start.y + event.clientY - start.startY),
    });
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragStartRef.current?.pointerId === event.pointerId) {
      dragStartRef.current = null;
    }
  }

  function rotate() {
    updateCrop({
      rotation: (((crop.rotation + 90) % 360) || 0) as PhotoCropMetadata["rotation"],
    });
  }

  return (
    <div
      aria-labelledby="photo-crop-editor-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end bg-stone-950/55 p-0 sm:items-center sm:p-5"
      role="dialog"
    >
      <div className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-lg bg-white shadow-xl sm:mx-auto sm:max-w-[560px] sm:rounded-lg">
        <div className="relative border-b border-stone-200 px-4 py-2 pr-12 sm:px-4 sm:pr-12">
          <h2
            className="text-base font-semibold text-stone-950"
            id="photo-crop-editor-title"
          >
            Edit photo crop
          </h2>
          <p className="mt-0.5 truncate text-xs font-semibold text-stone-500">
            {photo.label}
          </p>
          <button
            aria-label="Close crop editor"
            className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full border border-stone-200 bg-white text-lg font-semibold leading-none text-stone-600 transition hover:bg-stone-50 hover:text-stone-950"
            type="button"
            onClick={onCancel}
          >
            x
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-2 overflow-hidden p-3">
          <div
            className="relative mx-auto aspect-[4/3] w-full max-w-[300px] cursor-move touch-none overflow-hidden rounded-md border border-stone-300 bg-stone-100 sm:max-w-[320px]"
            onPointerCancel={endDrag}
            onPointerDown={beginDrag}
            onPointerMove={moveImage}
            onPointerUp={endDrag}
          >
            <Image
              alt={photo.altText || photo.label}
              className="h-full w-full select-none object-cover"
              draggable={false}
              fill
              sizes="(max-width: 640px) 100vw, 672px"
              src={photo.url}
              style={getCropImageStyle(crop)}
              unoptimized
            />
            <div className="pointer-events-none absolute inset-0 border-2 border-white/90 shadow-[inset_0_0_0_9999px_rgba(0,0,0,0.08)]" />
          </div>

          <label className="mx-auto grid w-full max-w-[320px] gap-1 text-sm font-semibold text-stone-700">
            Zoom
            <input
              className="accent-emerald-800"
              max="3"
              min="0.5"
              step="0.05"
              type="range"
              value={crop.zoom}
              onChange={(event) =>
                updateCrop({ zoom: Number(event.target.value) })
              }
            />
          </label>

          <div className="mx-auto flex w-full max-w-[320px] flex-wrap gap-2">
            <button className="seller-secondary-button" type="button" onClick={rotate}>
              Rotate 90
            </button>
            <button
              className="seller-secondary-button"
              type="button"
              onClick={() => setCrop(defaultCrop)}
            >
              Center
            </button>
            <button className="seller-secondary-button" type="button" onClick={onReset}>
              Reset crop
            </button>
          </div>
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-stone-200 bg-white px-4 py-2 sm:flex-row sm:justify-end">
          <button className="seller-secondary-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="seller-primary-button"
            disabled={isSaving}
            type="button"
            onClick={() => onSave(crop)}
          >
            {isSaving ? "Saving" : "Save crop"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function getCropImageStyle(crop: PhotoCropMetadata | null | undefined) {
  const normalized = normalizeCrop(crop);

  return {
    transform: `translate(${normalized.x}px, ${normalized.y}px) scale(${normalized.zoom}) rotate(${normalized.rotation}deg)`,
  };
}

export function normalizeCrop(
  crop: PhotoCropMetadata | null | undefined,
): PhotoCropMetadata {
  if (!crop) return defaultCrop;

  return {
    aspect: Number.isFinite(crop.aspect) && crop.aspect > 0 ? crop.aspect : 4 / 3,
    x: Number.isFinite(crop.x) ? Math.round(crop.x) : 0,
    y: Number.isFinite(crop.y) ? Math.round(crop.y) : 0,
    zoom: Number.isFinite(crop.zoom) && crop.zoom > 0 ? crop.zoom : 1,
    rotation: [0, 90, 180, 270].includes(crop.rotation) ? crop.rotation : 0,
  };
}
