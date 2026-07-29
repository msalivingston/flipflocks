export type AddCustomerValues = {
  name: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  notes: string;
};

export type AddCustomerErrors = Partial<
  Record<"name" | "phone" | "email", string>
>;

export function validateAddCustomer(values: AddCustomerValues) {
  const errors: AddCustomerErrors = {};

  if (!values.name.trim()) {
    errors.name = "Enter the customer’s name.";
  }

  const phoneDigits = normalizePhone(values.phone);
  if (values.phone.trim() && phoneDigits.length !== 10) {
    errors.phone = "Enter a 10-digit phone number.";
  }

  if (values.email.trim() && !isValidEmail(values.email)) {
    errors.email = "Enter a valid email address.";
  }

  return errors;
}

export function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function normalizePhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export function formatPhoneNumber(value: string) {
  const digits = normalizePhone(value).slice(0, 10);

  if (digits.length <= 3) return digits;
  if (digits.length <= 6) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  }

  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function splitCustomerName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() ?? "",
    lastName: parts.join(" ") || null,
  };
}

export function findPossibleDuplicate<
  T extends { email: string | null; phone: string | null },
>(customers: T[], values: Pick<AddCustomerValues, "email" | "phone">) {
  const email = normalizeEmail(values.email);
  const phone = normalizePhone(values.phone);

  if (!email && !phone) return null;

  return (
    customers.find(
      (customer) =>
        (email && normalizeEmail(customer.email) === email) ||
        (phone && normalizePhone(customer.phone) === phone),
    ) ?? null
  );
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
