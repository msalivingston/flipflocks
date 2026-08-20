export type CustomerDisplayIdentity = {
  first_name?: string | null;
  last_name?: string | null;
  business_name?: string | null;
  email?: string | null;
  phone?: string | null;
};

function clean(value: string | null | undefined) {
  return value?.trim() ?? "";
}

export function formatCustomerDisplayName(customer: CustomerDisplayIdentity) {
  const personalName = [clean(customer.first_name), clean(customer.last_name)]
    .filter(Boolean)
    .join(" ");

  return (
    personalName ||
    clean(customer.business_name) ||
    clean(customer.email) ||
    clean(customer.phone) ||
    "Customer"
  );
}

export function formatCustomerDisplayInitials(
  customer: CustomerDisplayIdentity,
) {
  const personalInitials = [clean(customer.first_name), clean(customer.last_name)]
    .filter(Boolean)
    .map((value) => value.charAt(0))
    .join("");

  if (personalInitials) return personalInitials.slice(0, 2).toUpperCase();

  const fallback = formatCustomerDisplayName(customer);
  if (fallback === "Customer") return "CU";

  return fallback.slice(0, 2).toUpperCase();
}
