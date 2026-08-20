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
  customerDuplicateMatchLabel,
  formatPhoneNumber,
  normalizeEmail,
  revealCustomerDuplicateWarning,
  validateAddCustomer,
} from "./add-customer-validation";

const initialValues: AddCustomerValues = {
  firstName: "",
  lastName: "",
  businessName: "",
  phone: "",
  email: "",
  street: "",
  city: "",
  state: "",
  postalCode: "",
  notes: "",
};

type DuplicateCustomer = {
  customer_id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  email: string | null;
  phone: string | null;
  email_matches: boolean;
  phone_matches: boolean;
};

type EditableCustomerResult = {
  id: string;
  first_name: string;
  last_name: string;
  business_name: string | null;
  email: string | null;
  phone: string | null;
  delivery_address_line1: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_postal_code: string | null;
  delivery_country: string | null;
  internal_notes: string | null;
};

export type CreatedCustomer = {
  customer_id: string;
  first_name: string;
  last_name: string;
  business_name: string | null;
  email: string | null;
  phone: string | null;
};

export type EditableCustomer = CreatedCustomer & {
  delivery_address_line1: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_postal_code: string | null;
  delivery_country: string | null;
  internal_notes: string | null;
};

export function AddCustomerButton({
  className,
  children,
  onCreated,
  requireEmail = false,
}: {
  className: string;
  children: React.ReactNode;
  onCreated?: (customer: CreatedCustomer) => void;
  requireEmail?: boolean;
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
      {open ? (
        <CustomerModal
          onClose={closeModal}
          onCreated={onCreated}
          requireEmail={requireEmail}
        />
      ) : null}
    </>
  );
}

export function EditCustomerButton({
  className,
  customer,
  children,
  onUpdated,
}: {
  className: string;
  customer: EditableCustomer;
  children: React.ReactNode;
  onUpdated: (customer: EditableCustomer) => void;
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
        aria-label={`Edit ${customer.first_name} ${customer.last_name}`}
        className={className}
        title="Edit customer"
        type="button"
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open ? (
        <CustomerModal
          customer={customer}
          onClose={closeModal}
          onUpdated={onUpdated}
          requireEmail={false}
        />
      ) : null}
    </>
  );
}

function CustomerModal({
  customer,
  onClose,
  onCreated,
  onUpdated,
  requireEmail,
}: {
  customer?: EditableCustomer;
  onClose: () => void;
  onCreated?: (customer: CreatedCustomer) => void;
  onUpdated?: (customer: EditableCustomer) => void;
  requireEmail: boolean;
}) {
  const isEditing = Boolean(customer);
  const router = useRouter();
  const { seller } = useSellerContext();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const duplicateWarningRef = useRef<HTMLDivElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [values, setValues] = useState<AddCustomerValues>(() =>
    customer
      ? {
          firstName: customer.first_name,
          lastName: customer.last_name,
          businessName: customer.business_name ?? "",
          phone: formatPhoneNumber(customer.phone ?? ""),
          email: customer.email ?? "",
          street: customer.delivery_address_line1 ?? "",
          city: customer.delivery_city ?? "",
          state: customer.delivery_state ?? "",
          postalCode: customer.delivery_postal_code ?? "",
          notes: customer.internal_notes ?? "",
        }
      : initialValues,
  );
  const [errors, setErrors] = useState<AddCustomerErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateCustomer[]>([]);
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

  useEffect(() => {
    if (duplicates.length === 0 || !duplicateWarningRef.current) return;
    revealCustomerDuplicateWarning(duplicateWarningRef.current);
  }, [duplicates]);

  function updateValue(field: keyof AddCustomerValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setDuplicates([]);
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveCustomer(false);
  }

  async function saveCustomer(createAnyway: boolean) {
    const nextErrors = validateAddCustomer(values);
    if (requireEmail && !values.email.trim()) {
      nextErrors.email = "Enter the customer’s email for this order.";
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      if (nextErrors.firstName) nameRef.current?.focus();
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
        .rpc("seller_find_possible_customer_duplicates", {
          p_store_id: seller.store_id,
          p_email: values.email,
          p_phone: values.phone,
          p_exclude_customer_id: customer?.customer_id ?? null,
        });
      const duplicateMatches = Array.isArray(existingResult.data)
        ? (existingResult.data as DuplicateCustomer[])
        : [];

      if (!existingResult.error && duplicateMatches.length > 0) {
        setDuplicates(duplicateMatches);
        setIsSaving(false);
        return;
      }
    }

    const customerValues = {
      first_name: values.firstName.trim(),
      last_name: values.lastName.trim(),
      business_name: values.businessName.trim() || null,
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
          ? customer?.delivery_country || "US"
          : null,
      internal_notes: values.notes.trim() || null,
    };
    const customerSelect =
      "id, first_name, last_name, business_name, email, phone, delivery_address_line1, delivery_city, delivery_state, delivery_postal_code, delivery_country, internal_notes";
    const saveResult = isEditing
      ? await supabase
          .from("customers")
          .update(customerValues)
          .eq("id", customer!.customer_id)
          .eq("store_id", seller.store_id)
          .select(customerSelect)
          .single<EditableCustomerResult>()
      : await supabase
          .from("customers")
          .insert({ store_id: seller.store_id, ...customerValues })
          .select(customerSelect)
          .single<EditableCustomerResult>();

    if (saveResult.error) {
      setFormError(
        saveResult.error.message ||
          (isEditing
            ? "Customer changes could not be saved."
            : "Customer could not be added."),
      );
      setIsSaving(false);
      return;
    }

    const savedCustomer: EditableCustomer = {
      customer_id: saveResult.data.id,
      first_name: saveResult.data.first_name,
      last_name: saveResult.data.last_name,
      business_name: saveResult.data.business_name,
      email: saveResult.data.email,
      phone: saveResult.data.phone,
      delivery_address_line1: saveResult.data.delivery_address_line1,
      delivery_city: saveResult.data.delivery_city,
      delivery_state: saveResult.data.delivery_state,
      delivery_postal_code: saveResult.data.delivery_postal_code,
      delivery_country: saveResult.data.delivery_country,
      internal_notes: saveResult.data.internal_notes,
    };

    if (isEditing) {
      onUpdated?.(savedCustomer);
      onClose();
      return;
    }

    const createdCustomer: CreatedCustomer = savedCustomer;

    if (onCreated) {
      onCreated(createdCustomer);
      onClose();
      return;
    }

    router.push(`/dashboard/customers/${createdCustomer.customer_id}`);
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (
      event.key === "Enter" &&
      duplicates.length > 0 &&
      event.target instanceof HTMLButtonElement
    ) {
      event.stopPropagation();
    }
  }

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
            aria-label={`Close ${isEditing ? "Edit" : "Add"} Customer`}
            className="inline-flex size-11 items-center justify-center rounded-full text-stone-700 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700 lg:hidden"
            disabled={isSaving}
            type="button"
            onClick={onClose}
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </button>
          <div className="min-w-0 flex-1 lg:pr-12">
            <h2 id={titleId} className="text-xl font-bold text-stone-950">
              {isEditing ? "Edit Customer" : "Add Customer"}
            </h2>
            <p className="mt-0.5 hidden text-sm text-stone-600 lg:block">
              {isEditing
                ? "Update customer details."
                : "Save customer details without creating an order."}
            </p>
          </div>
          <button
            aria-label={`Close ${isEditing ? "Edit" : "Add"} Customer`}
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
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="First Name"
                  required
                  error={errors.firstName}
                >
                  <input
                    ref={nameRef}
                    aria-invalid={Boolean(errors.firstName)}
                    autoComplete="given-name"
                    className="seller-form-field min-h-12"
                    value={values.firstName}
                    onChange={(event) =>
                      updateValue("firstName", event.target.value)
                    }
                  />
                </Field>
                <Field
                  label="Last Name"
                  required
                  error={errors.lastName}
                >
                  <input
                    aria-invalid={Boolean(errors.lastName)}
                    autoComplete="family-name"
                    className="seller-form-field min-h-12"
                    value={values.lastName}
                    onChange={(event) =>
                      updateValue("lastName", event.target.value)
                    }
                  />
                </Field>
              </div>
              <Field label="Farm or Business Name">
                <input
                  autoComplete="organization"
                  className="seller-form-field min-h-12"
                  value={values.businessName}
                  onChange={(event) =>
                    updateValue("businessName", event.target.value)
                  }
                />
              </Field>
              <Field label="Phone" error={errors.phone}>
                <input
                  aria-invalid={Boolean(errors.phone)}
                  autoComplete="tel"
                  className="seller-form-field min-h-12"
                  inputMode="tel"
                  placeholder="555-555-5555"
                  type="tel"
                  value={values.phone}
                  onChange={(event) =>
                    updateValue("phone", formatPhoneNumber(event.target.value))
                  }
                />
              </Field>
              <Field label="Email" required={requireEmail} error={errors.email}>
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
                  Mailing Address{" "}
                  <span className="font-normal text-stone-500">(optional)</span>
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

              {duplicates.length > 0 ? (
                <div
                  aria-live="polite"
                  className="rounded-xl border border-amber-300 bg-amber-50 p-4"
                  ref={duplicateWarningRef}
                  tabIndex={-1}
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
                        {duplicates.length === 1
                          ? "A customer with matching contact information may already exist."
                          : `${duplicates.length} customers with matching contact information may already exist.`}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {duplicates.map((duplicate) => {
                      const duplicateName =
                        [duplicate.first_name, duplicate.last_name]
                          .filter(Boolean)
                          .join(" ") || "Existing customer";

                      return (
                        <div
                          key={duplicate.customer_id}
                          className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-white/70 p-3"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-stone-900">
                              {duplicateName}
                            </p>
                            {duplicate.business_name ? (
                              <p className="text-sm text-stone-600">
                                {duplicate.business_name}
                              </p>
                            ) : null}
                            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                              {customerDuplicateMatchLabel(duplicate)}
                            </p>
                            <p className="mt-1 break-words text-sm text-stone-600">
                              {[duplicate.email, duplicate.phone]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                          <button
                            className="seller-secondary-button min-h-10 shrink-0 px-3"
                            type="button"
                            onClick={() =>
                              router.push(
                                `/dashboard/customers/${duplicate.customer_id}`,
                              )
                            }
                          >
                            View
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4">
                    <button
                      className="seller-primary-button min-h-11 w-full"
                      disabled={isSaving}
                      type="button"
                      onClick={() => void saveCustomer(true)}
                    >
                      {isSaving
                        ? "Saving…"
                        : isEditing
                          ? "Save Anyway"
                          : "Create Anyway"}
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

          <footer className="sticky bottom-0 z-10 grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-t border-stone-200 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 lg:flex lg:justify-end lg:px-6 lg:pb-4">
            <button
              className="seller-secondary-button min-h-12 px-5 lg:min-h-11"
              disabled={isSaving}
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="seller-primary-button min-h-12 w-full rounded-md px-6 lg:min-h-11 lg:w-auto"
              disabled={isSaving}
              type="submit"
            >
              {isSaving
                ? "Saving customer…"
                : isEditing
                  ? "Save Changes"
                  : "Add Customer"}
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
