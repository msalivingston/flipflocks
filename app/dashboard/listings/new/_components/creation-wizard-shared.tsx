"use client";

export const sellerMediaSelect =
  "media_asset_id, media_link_id, store_id, entity_type, entity_id, display_context, public_url, alt_text, caption, sort_order, is_featured, crop_metadata, moderation_status, asset_status, visibility_status, original_filename, content_type, file_size_bytes, width_px, height_px";

export function ValidationMessage({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <h2 className="text-sm font-semibold text-amber-950">
        A few details need attention
      </h2>
      <ul className="mt-2 grid gap-1 text-sm leading-6 text-amber-800">
        {errors.map((item) => (
          <li key={item}>- {item}</li>
        ))}
      </ul>
    </div>
  );
}
