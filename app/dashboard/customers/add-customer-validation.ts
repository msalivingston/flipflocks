import {
  formatPhoneInput,
  getNanpPhoneDigits,
  isPhoneInputValid,
} from "../../../lib/phone-input.ts";

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

  if (!isPhoneInputValid(values.phone)) {
    errors.phone =
      "Enter a 10-digit US/Canada phone number or begin an international number with +.";
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
  return getNanpPhoneDigits(value);
}

export function formatPhoneNumber(value: string) {
  return formatPhoneInput(value);
}

export function customerDuplicateMatchLabel(match: CustomerDuplicateMatch) {
  if (match.email_matches && match.phone_matches) {
    return "Email and phone match";
  }
  if (match.email_matches) return "Email match";
  if (match.phone_matches) return "Phone match";
  return "Possible match";
}

export function revealCustomerDuplicateWarning(
  warning: Pick<HTMLElement, "focus" | "scrollIntoView">,
) {
  warning.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
  });
  warning.focus({ preventScroll: true });
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
