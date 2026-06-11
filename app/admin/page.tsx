import Link from "next/link";
import { AdminPageHeader } from "./_components/admin-ui";

export default function AdminPage() {
  return (
    <>
      <AdminPageHeader
        eyebrow="Internal"
        title="Platform Admin"
        description="Read-only support tools for viewing stores and operational status. Admin data access is enforced by database RPC checks."
        action={
          <Link className="seller-primary-button" href="/admin/stores">
            View Stores
          </Link>
        }
      />
      <div className="mx-auto grid w-full max-w-7xl gap-5 px-5 py-5 sm:px-7">
        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-stone-950">First slice</h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            This admin area is intentionally small: store list, store detail,
            support-safe order context, and recent admin activity. It does not
            include impersonation, broad editing, payments, or destructive
            actions.
          </p>
        </section>
      </div>
    </>
  );
}
