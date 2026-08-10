import { liveBirdsV2DraftMarker } from "../add-v2/live-birds/constants";

export type LiveBirdListingPublicationState = {
  listing_batch_id: string;
  internal_batch_label: string | null;
  listing_batch_visibility_status: string;
  has_published_activity: boolean;
  is_unfinished_add_v2_draft: boolean;
};

export function isUnfinishedAddV2LiveBirdDraft(
  state:
    | Pick<
        LiveBirdListingPublicationState,
        | "internal_batch_label"
        | "listing_batch_visibility_status"
        | "has_published_activity"
      >
    | null
    | undefined,
) {
  return Boolean(
    state &&
      state.listing_batch_visibility_status === "hidden" &&
      state.internal_batch_label === liveBirdsV2DraftMarker &&
      !state.has_published_activity,
  );
}

export function getLiveBirdInventoryManageHref({
  isUnfinishedDraft,
  listingBatchId,
}: {
  isUnfinishedDraft: boolean;
  listingBatchId: string;
}) {
  return isUnfinishedDraft
    ? `/dashboard/inventory/add-v2/live-birds?draftId=${listingBatchId}`
    : `/dashboard/inventory/${listingBatchId}/edit`;
}

export function getCoopActivationErrorMessage(message: string) {
  if (!message.includes("Coop includes up to 5 active birds")) return message;

  return "This inventory cannot be shown because it would exceed your Coop plan’s limit of 5 active birds for sale. Hide or reduce other live-poultry inventory, reduce this quantity, or upgrade to Market, then try again.";
}
