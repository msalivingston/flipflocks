import { OrderDetail } from "./order-detail";

export default async function SellerOrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  return <OrderDetail orderId={orderId} />;
}
