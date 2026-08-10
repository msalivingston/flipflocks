export type CancellationEmailQueueResult = {
  buyer_notification_queued?: boolean | null;
  seller_copy_queued?: boolean | null;
} | null | undefined;

export function getCancellationEmailQueueState(
  result: CancellationEmailQueueResult,
) {
  const buyerEmailQueued = Boolean(result?.buyer_notification_queued);
  const anyEmailQueued = Boolean(
    result?.buyer_notification_queued || result?.seller_copy_queued,
  );

  return { buyerEmailQueued, anyEmailQueued };
}
