import { CustomerDetail } from "./customer-detail";

export default async function SellerCustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;

  return <CustomerDetail customerId={customerId} />;
}
