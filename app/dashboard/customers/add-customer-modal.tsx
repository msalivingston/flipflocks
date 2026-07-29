"use client";

import { AlertTriangle, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../_components/seller-context";
import {
  type AddCustomerErrors,
  type AddCustomerValues,
  findPossibleDuplicate,
  formatPhoneNumber,
  normalizeEmail,
  splitCustomerName,
  validateAddCustomer,
} from "./add-customer-validation";

const initialValues: AddCustomerValues = {
  name: "",
  phone: "",
  email: "",
  street: "",
  city: "",
  state: "",
  postalCode: "",
  notes: "",
};

type DuplicateCustomer = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
};

export function AddCustomerButton({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  function closeModal() {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  return (
    <>
      <button
        ref={triggerRef}
        className={className}
        type="button"
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open ? <AddCustomerModal onClose={closeModal} /> : null}
    </>
  );
}

function AddCustomerModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { seller } = useSellerContext();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<AddCustomerErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateCustomer | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    nameRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSaving) {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href]',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSaving, onClose]);

  function updateValue(field: keyof AddCustomerValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setDuplicate(null);
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveCustomer(false);
  }

  async function saveCustomer(createAnyway: boolean) {
    const nextErrors = validateAddCustomer(values);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      if (nextErrors.name) nameRef.current?.focus();
      return;
    }

    if (!seller) {
      setFormError("Your store could not be loaded. Please try again.");
      return;
    }

    setIsSaving(true);
    setFormError(null);

    if (!createAnyway) {
      const existingResult = await supabase
        .from("customers")
        .select("id, first_name, last_name, email, phone")
        .eq("store_id", seller.store_id)
        .limit(500)
        .returns<DuplicateCustomer[]>();

      if (existingResult.error) {
        setFormError("We could not check for an existing customer. Please try again.");
        setIsSaving(false);
        return;
      }

      const possibleDuplicate = findPossibleDuplicate(
        existingResult.data ?? [],
        values,
      );
      if (possibleDuplicate) {
        setDuplicate(possibleDuplicate);
        setIsSaving(false);
        return;
      }
    }

    const { firstName, lastName } = splitCustomerName(values.name);
    const insertResult = await supabase
      .from("customers")
      .insert({
        store_id: seller.store_id,
        first_name: firstName,
        last_name: lastName,
        email: normalizeEmail(values.email) || null,
        phone: values.phone.trim() || null,
        delivery_address_line1: values.street.trim() || null,
        delivery_city: values.city.trim() || null,
        delivery_state: values.state.trim() || null,
        delivery_postal_code: values.postalCode.trim() || null,
        delivery_country:
          values.street.trim() ||
          values.city.trim() ||
          values.state.trim() ||
          values.postalCode.trim()
            ? "US"
            : null,
        internal_notes: values.notes.trim() || null,
      })
      .select("id")
      .single<{ id: string }>();

    if (insertResult.error) {
      setFormError(insertResult.error.message || "Customer could not be added.");
      setIsSaving(false);
      return;
    }

    router.push(`/dashboard/customers/${insertResult.data.id}`);
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && duplicate && event.target instanceof HTMLButtonElement) {
      event.stopPropagation();
    }
  }

  const duplicateName = duplicate
    ? [duplicate.first_name, duplicate.last_name].filter(Boolean).join(" ") ||
      "Existing customer"
    : "";

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-[80] flex items-stretch justify-center bg-stone-950/45 lg:items-center lg:px-4 lg:py-6"
      role="dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl lg:h-auto lg:max-h-[calc(100dvh-3rem)] lg:max-w-xl lg:rounded-2xl lg:border lg:border-stone-200"
        onKeyDown={handleDialogKeyDown}
      >
        <header className="sticky top-0 z-10 flex min-h-16 items-center border-b border-stone-200 bg-white px-4 lg:px-6">
          <button
            aria-label="Close Add Customer"
            className="inline-flex size-11 items-center justify-center rounded-full text-stone-700 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700 lg:hidden"
            disabled={isSaving}
            type="button"
            onClick={onClose}
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </button>
          <div className="min-w-0 flex-1 lg:pr-12">
            <h2 id={titleId} className="text-xl font-bold text-stone-950">
              Add Customer
            </h2>
            <p className="mt-0.5 hidden text-sm text-stone-600 lg:block">
              Save customer details without creating an order.
            </p>
          </div>
          <button
            aria-label="Close Add Customer"
            className="absolute right-4 top-3 hidden size-10 items-center justify-center rounded-full text-2xl leading-none text-stone-500 transition hover:bg-stone-100 hover:text-stone-950 focus:outline-none focus:ring-2 focus:ring-emerald-700 lg:inline-flex"
            disabled={isSaving}
            type="button"
            onClick={onClose}
          >
            &times;
          </button>
        </header>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 pb-32 lg:px-6 lg:pb-6">
            <div className="grid gap-4">
              <Field label="Name" required error={errors.name}>
                <input
                  ref={nameRef}
                  aria-invalid={Boolean(errors.name)}
                  autoComplete="name"
                  className="seller-form-field min-h-12"
                  value={values.name}
                  onChange={(event) => updateValue("name", event.target.value)}
                />
              </Field>
              <Field label="Phone" error={errors.phone}>
                <input
                  aria-invalid={Boolean(errors.phone)}
                  autoComplete="tel"
                  className="seller-form-field min-h-12"
                  inputMode="tel"
                  placeholder="(555) 555-5555"
                  value={values.phone}
                  onChange={(event) =>
                    updateValue("phone", formatPhoneNumber(event.target.value))
                  }
                />
              </Field>
              <Field label="Email" error={errors.email}>
                <input
                  aria-invalid={Boolean(errors.email)}
                  autoCapitalize="none"
                  autoComplete="email"
                  className="seller-form-field min-h-12"
                  inputMode="email"
                  type="email"
                  value={values.email}
                  onChange={(event) => updateValue("email", event.target.value)}
                />
              </Field>

              <fieldset className="grid gap-4 border-t border-stone-200 pt-4">
                <legend className="mb-1 text-base font-bold text-stone-900">
                  Address <span className="font-normal text-stone-500">(optional)</span>
                </legend>
                <Field label="Street address">
                  <input
                    autoComplete="street-address"
                    className="seller-form-field min-h-12"
                    value={values.street}
                    onChange={(event) => updateValue("street", event.target.value)}
                  />
                </Field>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_7rem_8rem]">
                  <Field label="City">
                    <input
                      autoComplete="address-level2"
                      className="seller-form-field min-h-12"
                      value={values.city}
                      onChange={(event) => updateValue("city", event.target.value)}
                    />
                  </Field>
                  <Field label="State">
                    <input
                      autoCapitalize="characters"
                      autoComplete="address-level1"
                      className="seller-form-field min-h-12"
                      maxLength={2}
                      value={values.state}
                      onChange={(event) =>
                        updateValue("state", event.target.value.toUpperCase())
                      }
                    />
                  </Field>
                  <Field label="ZIP code">
                    <input
                      autoComplete="postal-code"
                      className="seller-form-field min-h-12"
                      inputMode="numeric"
                      value={values.postalCode}
                      onChange={(event) =>
                        updateValue("postalCode", event.target.value)
                      }
                    />
                  </Field>
                </div>
              </fieldset>

              <Field
                label="Notes"
                helper="Private notes only you can see."
              >
                <textarea
                  className="seller-form-field min-h-28 resize-y"
                  value={values.notes}
                  onChange={(event) => updateValue("notes", event.target.value)}
                />
              </Field>

              {duplicate ? (
                <div
                  aria-live="polite"
                  className="rounded-xl border border-amber-300 bg-amber-50 p-4"
                >
                  <div className="flex gap-3">
                    <AlertTriangle
                      aria-hidden="true"
                      className="mt-0.5 size-5 shrink-0 text-amber-700"
                    />
                    <div>
                      <p className="font-bold text-stone-950">
                        Possible duplicate
                      </p>
                      <p className="mt-1 text-sm leading-6 text-stone-700">
                        A customer with this phone number or email may already
                        exist.
                      </p>
                      <p className="mt-1 text-sm font-semibold text-stone-900">
                        {duplicateName}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <button
                      className="seller-secondary-button min-h-11"
                      type="button"
                      onClick={() =>
                        router.push(`/dashboard/customers/${duplicate.id}`)
                      }
                    >
                      View Customer
                    </button>
                    <button
                      className="seller-primary-button min-h-11"
                      disabled={isSaving}
                      type="button"
                      onClick={() => void saveCustomer(true)}
                    >
                      {isSaving ? "Adding…" : "Create Anyway"}
                    </button>
                  </div>
                </div>
              ) : null}

              {formError ? (
                <p
                  aria-live="assertive"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"
                >
                  {formError}
                </p>
              ) : null}
            </div>
          </div>

          <footer className="sticky bottom-0 z-10 border-t border-stone-200 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 lg:flex lg:justify-end lg:gap-3 lg:px-6 lg:pb-4">
            <button
              className="seller-secondary-button hidden min-h-11 px-5 lg:inline-flex"
              disabled={isSaving}
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="seller-primary-button min-h-12 w-full px-6 lg:min-h-11 lg:w-auto"
              disabled={isSaving}
              type="submit"
            >
              {isSaving ? "Adding customer…" : "Add Customer"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

function Field({
  children,
  error,
  helper,
  label,
  required = false,
}: {
  children: React.ReactNode;
  error?: string;
  helper?: string;
  label: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-bold text-stone-800">
      <span>
        {label}
        {required ? <span className="text-red-700"> *</span> : null}
      </span>
      {children}
      {helper ? (
        <span className="text-xs font-normal text-stone-500">{helper}</span>
      ) : null}
      {error ? (
        <span className="text-sm font-semibold text-red-700">{error}</span>
      ) : null}
    </label>
  );
}
