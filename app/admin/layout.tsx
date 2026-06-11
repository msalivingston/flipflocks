import { AdminAppShell } from "./_components/admin-app-shell";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminAppShell>{children}</AdminAppShell>;
}
