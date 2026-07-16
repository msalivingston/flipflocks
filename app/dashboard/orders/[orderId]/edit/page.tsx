import { EditOrder } from "./edit-order";

export default async function SellerEditOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  return <EditOrder orderId={orderId} />;
}
