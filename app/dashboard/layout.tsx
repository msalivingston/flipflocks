import { SellerAppShell } from "./_components/seller-app-shell";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SellerAppShell>{children}</SellerAppShell>;
}

