export type AddCustomerValues = {
  firstName: string;
  lastName: string;
  businessName: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  notes: string;
};

export type AddCustomerErrors = Partial<
  Record<"firstName" | "lastName" | "phone" | "email", string>
>;

export type CustomerDuplicateMatch = {
  email_matches: boolean;
  phone_matches: boolean;
};

export function validateAddCustomer(values: AddCustomerValues) {
  const errors: AddCustomerErrors = {};

  if (!values.firstName.trim()) {
    errors.firstName = "Enter the customer’s first name.";
  }

  if (!values.lastName.trim()) {
    errors.lastName = "Enter the customer’s last name.";
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

export function customerDuplicateMatchLabel(match: CustomerDuplicateMatch) {
  if (match.email_matches && match.phone_matches) {
    return "Email and phone match";
  }
  if (match.email_matches) return "Email match";
  if (match.phone_matches) return "Phone match";
  return "Possible match";
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
