import { SellerPageHeader } from "../_components/seller-ui";
import { ReportsDashboard } from "./reports-dashboard";

export default function SellerReportsPage() {
  return (
    <>
      <SellerPageHeader
        title="Reports"
        description="Track sales, orders, customers, and item activity."
      />
      <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
        <ReportsDashboard />
      </div>
    </>
  );
}
