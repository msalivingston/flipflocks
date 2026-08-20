export function isInternationalPhoneInput(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.startsWith("+") && !trimmed.startsWith("+1");
}

export function getNanpPhoneDigits(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  const digits = trimmed.replace(/\D/g, "");

  if (trimmed.startsWith("+1")) return digits.slice(1);
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function formatPhoneInput(value: string) {
  if (isInternationalPhoneInput(value)) return value;

  const digits = getNanpPhoneDigits(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;

  const formatted = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  const overflow = digits.slice(10);
  return overflow ? `${formatted} ${overflow}` : formatted;
}

export function isPhoneInputValid(
  value: string | null | undefined,
  options: { required?: boolean } = {},
) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return !options.required;
  if (isInternationalPhoneInput(trimmed)) return true;
  return getNanpPhoneDigits(trimmed).length === 10;
}
