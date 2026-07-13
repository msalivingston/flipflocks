"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { publicSupabase } from "@/lib/public-supabase";
import {
  StorefrontCart,
  cartItemKey,
  StorefrontCartItem,
  clearStorefrontCart,
  readStorefrontCart,
  summarizeStorefrontCart,
} from "../_components/storefront-cart-client";
import {
  loadStorefrontPickupOptions,
  type StorefrontHome,
  type StorefrontPickupOption,
} from "../storefront-data";
import {
  StorefrontButton,
  StorefrontCard,
  StorefrontGlyph,
  StorefrontInput,
  StorefrontLabel,
  StorefrontPage,
  StorefrontSummaryCard,
  StorefrontTextarea,
  formatCurrency,
  formatDate,
} from "../storefront-ui";

type BuyerForm = {
  buyerEmail: string;
  buyerFirstName: string;
  buyerLastName: string;
  buyerPhone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  buyerNotes: string;
  pickupNote: string;
  pickupOptionId: string;
};

type CheckoutSummary = {
  is_checkout_available: boolean;
  message: string | null;
  item_count: number;
  total_quantity: number;
  subtotal_amount: number | string;
  items: CheckoutSummaryItem[];
};

type CheckoutSummaryItem = {
  item_type: "listing_inventory" | "equipment_inventory" | string;
  item_id: string;
  inventory_item_id: string | null;
  equipment_inventory_item_id: string | null;
  processed_poultry_inventory_item_id: string | null;
  item_name: string;
  item_category: string;
  breed_display_name?: string;
  custom_inventory_label: string | null;
  inventory_type: string;
  requested_quantity: number;
  quantity_available: number;
  available_date: string;
  unit_price: number | string;
  line_subtotal: number | string;
};

type OrderResponse = {
  order?: {
    order_number?: string | null;
    total_amount?: number | string | null;
    currency?: string | null;
  } | null;
};

type SuccessState = {
  orderNumber: string | null;
  totalText: string;
};

const initialForm: BuyerForm = {
  buyerEmail: "",
  buyerFirstName: "",
  buyerLastName: "",
  buyerPhone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  buyerNotes: "",
  pickupNote: "",
  pickupOptionId: "",
};

const emptyCartItems: StorefrontCart["items"] = [];
const checkoutEyebrowClass =
  "[font-family:var(--storefront-body-font),Arial,Helvetica,sans-serif] text-xs font-extrabold uppercase tracking-[0.2em] text-[#073f1e]";
const compactFieldClass = "checkout-compact-field";
const compactLabelClass = "checkout-field-label min-w-0";
const pickupLabelClass = "grid min-w-0 gap-1 text-sm font-semibold text-stone-800";

export function CheckoutPage({ store }: { store: StorefrontHome }) {
  const router = useRouter();
  const [cart, setCart] = useState<StorefrontCart | null>(null);
  const [form, setForm] = useState<BuyerForm>(initialForm);
  const [summary, setSummary] = useState<CheckoutSummary | null>(null);
  const [summaryMessage, setSummaryMessage] = useState<string | null>(null);
  const [pickupOptions, setPickupOptions] = useState<StorefrontPickupOption[]>(
    [],
  );
  const [pickupOptionsError, setPickupOptionsError] = useState<string | null>(
    null,
  );
  const [isChecking, setIsChecking] = useState(false);
  const [isLoadingPickupOptions, setIsLoadingPickupOptions] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pickupError, setPickupError] = useState<string | null>(null);
  const [isPolicyOpen, setIsPolicyOpen] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const policyModalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setCart(readStorefrontCart(store.store_slug));
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [store.store_slug]);

  const usesManualPickupOptions = store.pickup_method === "manual_options";

  useEffect(() => {
    let isActive = true;

    const timeout = window.setTimeout(() => {
      if (!usesManualPickupOptions) {
        setPickupOptions([]);
        setPickupOptionsError(null);
        setIsLoadingPickupOptions(false);
        setForm((current) =>
          current.pickupOptionId
            ? { ...current, pickupOptionId: "" }
            : current,
        );
        return;
      }

      setIsLoadingPickupOptions(true);
      setPickupOptionsError(null);

      loadStorefrontPickupOptions(store.store_slug).then((result) => {
        if (!isActive) return;

        setPickupOptions(result.data);
        setPickupOptionsError(result.error?.message ?? null);
        setIsLoadingPickupOptions(false);
      });
    }, 0);

    return () => {
      isActive = false;
      window.clearTimeout(timeout);
    };
  }, [store.store_slug, usesManualPickupOptions]);

  const cartItems = cart?.items ?? emptyCartItems;
  const cartSummary = useMemo(
    () => summarizeStorefrontCart(cartItems),
    [cartItems],
  );
  const checkoutItems = useMemo(() => toCheckoutItems(cartItems), [cartItems]);
  const validatedSubtotal =
    summary?.is_checkout_available === true
      ? toNumber(summary.subtotal_amount)
      : null;
  const estimatedTotal = validatedSubtotal ?? cartSummary.subtotal;
  const selectedPickupOption = useMemo(
    () =>
      pickupOptions.find(
        (option) => option.pickup_option_id === form.pickupOptionId,
      ) ?? null,
    [form.pickupOptionId, pickupOptions],
  );
  const policySections = useMemo(() => buildPolicySections(store), [store]);
  const policySummary = getPolicySummary(store);
  const hasSellerContact = Boolean(store.public_phone || store.public_email);

  useEffect(() => {
    if (cart === null || checkoutItems.length === 0) {
      const timeout = window.setTimeout(() => {
        setSummary(null);
        setSummaryMessage(null);
        setIsChecking(false);
      }, 0);

      return () => window.clearTimeout(timeout);
    }

    let isActive = true;

    async function validateCart() {
      setIsChecking(true);
      setSummaryMessage(null);

      const { data, error } = await publicSupabase.rpc("get_public_checkout_summary", {
        p_store_slug: store.store_slug,
        p_items: checkoutItems,
      });

      if (!isActive) return;

      if (error) {
        setSummary(null);
        setSummaryMessage(
          "We could not verify this cart yet. Please try checkout again.",
        );
      } else {
        const nextSummary = Array.isArray(data)
          ? (data[0] as CheckoutSummary | undefined)
          : null;

        setSummary(nextSummary ?? null);
        setSummaryMessage(nextSummary?.message ?? null);
      }

      setIsChecking(false);
    }

    validateCart();

    return () => {
      isActive = false;
    };
  }, [cart, checkoutItems, store.store_slug]);

  function updateField(field: keyof BuyerForm, value: string) {
    if (field === "pickupNote" || field === "pickupOptionId") {
      setPickupError(null);
    }

    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  useEffect(() => {
    if (!isPolicyOpen) return;

    const modal = policyModalRef.current;
    const previousActiveElement = document.activeElement;

    window.setTimeout(() => {
      const firstFocusable = getFocusableElements(modal)[0];
      firstFocusable?.focus();
    }, 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsPolicyOpen(false);
        return;
      }

      if (event.key !== "Tab" || !modal) return;

      const focusable = getFocusableElements(modal);

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

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
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";

      if (previousActiveElement instanceof HTMLElement) {
        previousActiveElement.focus();
      }
    };
  }, [isPolicyOpen]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (checkoutItems.length === 0) {
      setErrorMessage("Your cart is empty.");
      return;
    }

    if (summary && !summary.is_checkout_available) {
      setErrorMessage(toBuyerOrderError(summary.message ?? undefined));
      return;
    }

    if (usesManualPickupOptions && !form.pickupOptionId) {
      setPickupError("Please choose a pickup option.");
      return;
    }

    if (!usesManualPickupOptions && !form.pickupNote.trim()) {
      setPickupError("Please suggest a pickup day and approximate time.");
      return;
    }

    setIsSubmitting(true);

    const payload = {
      store_slug: store.store_slug,
      idempotency_key: createIdempotencyKey(store.store_slug),
      buyer_email: form.buyerEmail.trim(),
      buyer_first_name: form.buyerFirstName.trim(),
      buyer_last_name: form.buyerLastName.trim(),
      buyer_phone: form.buyerPhone.trim(),
      delivery_address_line1: form.addressLine1.trim(),
      delivery_address_line2: form.addressLine2.trim() || null,
      delivery_city: form.city.trim(),
      delivery_state: form.state.trim(),
      delivery_postal_code: form.postalCode.trim(),
      delivery_country: "US",
      buyer_notes: form.buyerNotes.trim() || null,
      pickup_note: form.pickupNote.trim() || null,
      pickup_option_id: usesManualPickupOptions ? form.pickupOptionId : null,
      items: checkoutItems,
    };

    try {
      const { data, error } = await publicSupabase.functions.invoke<OrderResponse>(
        "pay-at-pickup-order",
        {
          body: payload,
        },
      );

      if (error) {
        const detail = await readFunctionError(error);
        setErrorMessage(toBuyerOrderError(detail?.message));
        router.refresh();
        return;
      }

      clearStorefrontCart(store.store_slug);
      setCart(readStorefrontCart(store.store_slug));
      setSuccess({
        orderNumber: data?.order?.order_number ?? null,
        totalText: formatOrderTotal(data?.order?.total_amount, estimatedTotal),
      });
      setForm(initialForm);
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  if (success) {
    return (
      <StorefrontPage size="narrow" className="py-10">
        <StorefrontCard className="border-emerald-200 p-6">
          <p className="storefront-primary-color text-sm font-semibold uppercase tracking-[0.12em] text-emerald-800">
            Order placed
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-stone-950">
            Your order has been placed.
          </h1>
          <p className="mt-3 text-sm leading-6 text-stone-600">
            The seller will follow up with pickup details.
          </p>
          <dl className="mt-5 grid gap-2 text-sm">
            {success.orderNumber ? (
              <SummaryRow label="Order number" value={success.orderNumber} />
            ) : null}
            <SummaryRow label="Estimated total" value={success.totalText} />
          </dl>
          <StorefrontButton className="mt-6" href={`/store/${store.store_slug}`}>
            Continue shopping
          </StorefrontButton>
        </StorefrontCard>
      </StorefrontPage>
    );
  }

  return (
    <StorefrontPage className="max-w-[70rem] gap-5 py-5 lg:gap-6 lg:py-6">
      <header>
        <h1 className="sr-only">Checkout</h1>
        <p className={checkoutEyebrowClass}>
          Checkout
        </p>
        <div className="mt-3 h-px w-14 bg-[#cbbd96]" />
        <p className="mt-1 text-sm leading-6 text-stone-600">
          Enter your information and review your order.
        </p>
      </header>

      {cart === null ? (
        <CheckoutPanel>
          <p className="text-sm text-stone-600">Loading checkout...</p>
        </CheckoutPanel>
      ) : cartItems.length === 0 ? (
        <CheckoutPanel>
          <h2 className="text-xl font-semibold text-stone-950">
            Your cart is empty
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Add available options before checkout.
          </p>
          <StorefrontButton className="mt-4 min-h-10" href={`/store/${store.store_slug}`}>
            Continue shopping
          </StorefrontButton>
        </CheckoutPanel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <form
            className="order-2 rounded-lg border border-[#ded7c8] bg-white p-3 sm:p-4 lg:order-1"
            onSubmit={handleSubmit}
          >
            <div className="grid gap-3">
              <CheckoutSection title="Contact information">
                <div className="grid gap-1.5 sm:grid-cols-2">
                <TextField
                  label="First name"
                  name="buyerFirstName"
                  onChange={(value) => updateField("buyerFirstName", value)}
                  value={form.buyerFirstName}
                />
                <TextField
                  label="Last name"
                  name="buyerLastName"
                  onChange={(value) => updateField("buyerLastName", value)}
                  value={form.buyerLastName}
                />
                </div>

              <TextField
                label="Email"
                name="buyerEmail"
                onChange={(value) => updateField("buyerEmail", value)}
                type="email"
                value={form.buyerEmail}
              />
              <TextField
                label="Phone"
                name="buyerPhone"
                onChange={(value) => updateField("buyerPhone", value)}
                type="tel"
                value={form.buyerPhone}
              />
                <div className="grid gap-1.5 md:grid-cols-[1.15fr_0.85fr]">
                  <TextField
                    label="Address line 1"
                    name="addressLine1"
                    onChange={(value) => updateField("addressLine1", value)}
                    value={form.addressLine1}
                  />
                  <TextField
                    label="Address line 2"
                    name="addressLine2"
                    onChange={(value) => updateField("addressLine2", value)}
                    required={false}
                    value={form.addressLine2}
                  />
                </div>
                <div className="checkout-city-grid grid gap-1.5">
                <TextField
                  label="City"
                  name="city"
                  onChange={(value) => updateField("city", value)}
                  value={form.city}
                />
                <TextField
                  label="State"
                  maxLength={40}
                  name="state"
                  onChange={(value) => updateField("state", value)}
                  value={form.state}
                />
                <TextField
                  label="ZIP"
                  maxLength={20}
                  name="postalCode"
                  onChange={(value) => updateField("postalCode", value)}
                  value={form.postalCode}
                />
                </div>
              </CheckoutSection>

              <CheckoutSection title="Pickup arrangements">
                {usesManualPickupOptions ? (
                  <>
                    <label className={pickupLabelClass}>
                      Pickup option
                      <select
                        aria-describedby={
                          pickupError ? "pickup-option-error" : undefined
                        }
                        aria-invalid={Boolean(pickupError)}
                        className={`${compactFieldClass} rounded-md border border-stone-300 bg-white font-normal text-stone-950 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:bg-stone-100 disabled:text-stone-400`}
                        disabled={isLoadingPickupOptions}
                        onChange={(event) =>
                          updateField("pickupOptionId", event.target.value)
                        }
                        required
                        value={form.pickupOptionId}
                      >
                        <option value="">
                          {isLoadingPickupOptions
                            ? "Loading pickup choices..."
                            : "Choose a pickup option"}
                        </option>
                        {pickupOptions.map((option) => (
                          <option
                            key={option.pickup_option_id}
                            value={option.pickup_option_id}
                          >
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedPickupOption ? (
                      <PickupOptionSummary option={selectedPickupOption} />
                    ) : null}
                  </>
                ) : (
                  <TextArea
                    helperText="Please suggest a day and approximate time. The seller will contact you to confirm."
                    label="When would you like to pick up your order?"
                    maxLength={1000}
                    name="pickupNote"
                    onChange={(value) => updateField("pickupNote", value)}
                    required
                    value={form.pickupNote}
                  />
                )}
                {pickupError ? (
                  <p
                    className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-800"
                    id="pickup-option-error"
                  >
                    {pickupError}
                  </p>
                ) : null}
                {pickupOptionsError ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
                    Pickup choices could not load. Please refresh and try again.
                  </p>
                ) : null}
              </CheckoutSection>

              <CheckoutSection
                helperText="Anything else the seller should know about your order?"
                title="Order notes"
              >
                <TextArea
                  label="Order notes"
                  maxLength={500}
                  name="buyerNotes"
                  onChange={(value) => updateField("buyerNotes", value)}
                  required={false}
                  showLabel={false}
                  value={form.buyerNotes}
                />
              </CheckoutSection>

              <CheckoutSection title="Payment">
                <div className="rounded-md border border-amber-200 bg-[#fff8e6] p-3 text-sm leading-6 text-stone-800">
                  <p className="font-semibold text-stone-950">Pay at pickup</p>
                  <p className="mt-1">
                    No payment is required today. You will pay{" "}
                    <span className="font-semibold">
                      {formatCurrency(estimatedTotal)}
                    </span>{" "}
                    directly to {store.store_name} when you pick up your order.
                  </p>
                </div>
              </CheckoutSection>

              {errorMessage ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-800">
                  {errorMessage}
                </div>
              ) : null}

              <StorefrontButton
                className="w-full"
                disabled={
                  isSubmitting ||
                  isChecking ||
                  isLoadingPickupOptions ||
                  checkoutItems.length === 0 ||
                  summary?.is_checkout_available === false ||
                  (usesManualPickupOptions && !form.pickupOptionId) ||
                  (!usesManualPickupOptions && !form.pickupNote.trim())
                }
                type="submit"
              >
                {isSubmitting ? "Placing order..." : "Place order — pay at pickup"}
              </StorefrontButton>
              <p className="text-center text-xs leading-5 text-stone-500">
                Your information is secure and will only be used for your order.
              </p>
            </div>
          </form>

          <aside className="order-1 grid h-fit gap-4 lg:order-2">
            <StorefrontSummaryCard className="p-3 sm:p-4">
              <p className={checkoutEyebrowClass}>
                Your order
              </p>
              <div className="mt-3 grid gap-3 divide-y divide-[#eee5d6]">
                {cartItems.map((item) => (
                  <div
                    className="grid gap-1 pt-3 text-sm first:pt-0"
                    key={cartItemKey(item)}
                  >
                    <div className="flex justify-between gap-3">
                      <p className="min-w-0 font-semibold text-stone-950">
                        {item.productName}
                      </p>
                      <p className="shrink-0 font-semibold text-stone-950">
                        {formatCurrency(item.unitPrice * item.quantity)}
                      </p>
                    </div>
                    <p className="text-stone-600">
                      {item.quantity} x {item.optionLabel}
                    </p>
                    <p className="text-stone-500">
                      {formatCartAvailability(item.availableDate)}
                    </p>
                  </div>
                ))}
              </div>
              <dl className="mt-4 grid gap-2 border-t border-[#eee5d6] pt-3 text-sm">
                <SummaryRow
                  label="Items"
                  value={String(summary?.total_quantity ?? cartSummary.totalQuantity)}
                />
                <SummaryRow
                  label="Estimated total"
                  value={formatCurrency(estimatedTotal)}
                />
              </dl>
              {isChecking ? (
                <p className="mt-3 text-sm text-stone-500">
                  Checking availability...
                </p>
              ) : null}
              {summaryMessage ? (
                <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {toBuyerOrderError(summaryMessage)}
                </p>
              ) : null}
              <StorefrontButton
                className="mt-3 min-h-10 w-full"
                href={`/store/${store.store_slug}/cart`}
                variant="secondary"
              >
                View cart & edit
              </StorefrontButton>

            </StorefrontSummaryCard>

            <StorefrontSummaryCard className="bg-[#fffdf8] p-3 sm:p-4">
              <div className="flex items-center gap-3">
                <StorefrontGlyph
                  className="storefront-primary-color h-7 w-7 text-[#073f1e]"
                  src="/glyphs/clipboard.png"
                />
                <p className={checkoutEyebrowClass}>
                  Pickup & policies
                </p>
              </div>
              <div className="mt-3 grid gap-2 whitespace-pre-line text-[1.05rem] leading-[1.3] text-stone-600">
        <p>{policySummary}</p>
      </div>
              {policySections.length > 0 ? (
                <button
                  className="storefront-primary-color mt-4 text-left text-sm font-semibold text-[#073f1e] underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
                  onClick={() => setIsPolicyOpen(true)}
                  type="button"
                >
                  View full policy
                </button>
              ) : null}
            </StorefrontSummaryCard>

            {hasSellerContact ? (
              <StorefrontSummaryCard className="p-3 sm:p-4">
                <h2 className="text-base font-semibold text-stone-950">
                  Questions?
                </h2>
                <div className="mt-3 grid gap-2 text-sm leading-6 text-stone-600">
                  {store.public_phone ? (
                    <a href={`tel:${store.public_phone}`}>{store.public_phone}</a>
                  ) : null}
                  {store.public_email ? (
                    <a href={`mailto:${store.public_email}`}>{store.public_email}</a>
                  ) : null}
                </div>
              </StorefrontSummaryCard>
            ) : null}
          </aside>
        </div>
      )}
      {isPolicyOpen ? (
        <PolicyModal
          onClose={() => setIsPolicyOpen(false)}
          sections={policySections}
          storeName={store.store_name}
          modalRef={policyModalRef}
        />
      ) : null}
    </StorefrontPage>
  );
}

function CheckoutPanel({ children }: { children: React.ReactNode }) {
  return (
    <StorefrontCard>
      {children}
    </StorefrontCard>
  );
}

function TextField({
  label,
  maxLength,
  name,
  onChange,
  required = true,
  type = "text",
  value,
}: {
  label: string;
  maxLength?: number;
  name: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: "email" | "tel" | "text";
  value: string;
}) {
  return (
    <StorefrontLabel className={compactLabelClass}>
      {label}
      <StorefrontInput
        className={compactFieldClass}
        maxLength={maxLength}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        type={type}
        value={value}
      />
    </StorefrontLabel>
  );
}

function TextArea({
  helperText,
  label,
  maxLength = 2000,
  name,
  onChange,
  required = false,
  showLabel = true,
  value,
}: {
  helperText?: string;
  label: string;
  maxLength?: number;
  name: string;
  onChange: (value: string) => void;
  required?: boolean;
  showLabel?: boolean;
  value: string;
}) {
  return (
    <StorefrontLabel className={compactLabelClass}>
      {showLabel ? label : <span className="sr-only">{label}</span>}
      <StorefrontTextarea
        className="!min-h-12 w-full min-w-0 !px-2 !py-1 !text-[0.86rem] !leading-4"
        maxLength={maxLength}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        value={value}
      />
      {helperText ? (
        <span className="text-xs font-medium leading-5 text-stone-500">
          {helperText}
        </span>
      ) : null}
    </StorefrontLabel>
  );
}

function CheckoutSection({
  children,
  helperText,
  title,
}: {
  children: React.ReactNode;
  helperText?: string;
  title: string;
}) {
  return (
    <section className="grid gap-2 border-b border-[#eee5d6] pb-3.5 last:border-b-0 last:pb-0">
      <div>
        <h2 className="storefront-primary-color text-lg font-semibold text-[#073f1e]">
          {title}
        </h2>
        {helperText ? (
          <p className="mt-1 text-sm leading-6 text-stone-600">{helperText}</p>
        ) : null}
      </div>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function PickupOptionSummary({ option }: { option: StorefrontPickupOption }) {
  const lines = parsePickupOptionSummary(option);

  return (
    <div className="rounded-md border border-emerald-100 bg-emerald-50/40 px-3 py-2 text-sm leading-6 text-stone-700">
      <p className="font-semibold text-stone-950">{option.label}</p>
      {lines.length > 0 ? (
        <dl className="mt-1 grid gap-1">
          {lines.map((line) => (
            <div className="flex gap-2" key={`${line.label}-${line.value}`}>
              <dt className="min-w-20 font-semibold text-stone-600">
                {line.label}
              </dt>
              <dd>{line.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function PolicyModal({
  modalRef,
  onClose,
  sections,
  storeName,
}: {
  modalRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  sections: Array<{ body: string; title: string }>;
  storeName: string;
}) {
  return (
    <div
      aria-labelledby="checkout-policy-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-stone-950/45 p-4"
      role="dialog"
    >
      <div
        className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-hidden rounded-lg border border-[#ded7c8] bg-white shadow-xl sm:max-h-[42rem]"
        ref={modalRef}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#eee5d6] px-4 py-3 sm:px-5">
          <div>
            <h2
              className="text-xl font-semibold text-stone-950"
              id="checkout-policy-title"
            >
              Pickup & policies
            </h2>
            <p className="mt-1 text-sm text-stone-600">{storeName}</p>
          </div>
          <button
            className="rounded-md px-3 py-1.5 text-sm font-semibold text-stone-600 hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
        <div className="grid max-h-[calc(100vh-9rem)] gap-4 overflow-y-auto px-4 py-4 sm:px-5">
          {sections.map((section) => (
            <section className="grid gap-2" key={section.title}>
              <h3 className="font-semibold text-stone-950">{section.title}</h3>
              <p className="whitespace-pre-line text-sm leading-6 text-stone-700">
                {section.body}
              </p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-stone-600">{label}</dt>
      <dd className="font-semibold text-stone-950">{value}</dd>
    </div>
  );
}

function toCheckoutItems(items: StorefrontCartItem[]) {
  return items
    .filter((item) => item.quantity > 0)
    .map((item) => ({
      item_type: item.itemType,
      item_id: item.itemId,
      quantity: item.quantity,
    }));
}

function createIdempotencyKey(storeSlug: string) {
  const randomPart =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${storeSlug}:${randomPart}`;
}

function formatOrderTotal(
  totalAmount: number | string | null | undefined,
  fallback: number,
) {
  const numericTotal = toNumber(totalAmount);

  return formatCurrency(numericTotal ?? fallback);
}

function toNumber(value: number | string | null | undefined) {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : null;

  return typeof numericValue === "number" && Number.isFinite(numericValue)
    ? numericValue
    : null;
}

async function readFunctionError(error: unknown) {
  const context =
    error && typeof error === "object"
      ? (error as { context?: unknown }).context
      : null;

  if (context instanceof Response) {
    try {
      const body = (await context.json()) as unknown;

      if (body && typeof body === "object") {
        return {
          status: context.status,
          statusText: context.statusText,
          ...(body as { error?: string; message?: string }),
        };
      }
    } catch {
      return {
        status: context.status,
        statusText: context.statusText,
        message: context.statusText || "Order failed.",
      };
    }
  }

  return error && typeof error === "object"
    ? {
        message:
          typeof (error as { message?: unknown }).message === "string"
            ? (error as { message: string }).message
            : "Order failed.",
      }
    : {
        message: "Order failed.",
      };
}

function toBuyerOrderError(message: string | undefined) {
  if (
    message === "Insufficient inventory quantity available." ||
    message === "One or more checkout items are unavailable." ||
    message === "One or more items are no longer available."
  ) {
    return "That quantity is no longer available. Please review your cart and try again.";
  }

  if (message === "This store is currently unavailable.") {
    return "This storefront is not accepting orders right now.";
  }

  if (message?.includes("required") || message?.includes("invalid")) {
    return "Please check your contact details and try again.";
  }

  return "We could not place this order. Please try again.";
}

function formatCartAvailability(availableDate: string) {
  if (!availableDate) return "Available now";

  const today = new Date();
  const normalizedToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const availability = new Date(`${availableDate}T00:00:00`);

  if (availability <= normalizedToday) return "Available now";

  return `Available ${formatDate(availableDate)}`;
}

function parsePickupOptionSummary(option: StorefrontPickupOption) {
  const description = option.description?.trim();

  if (!description) return [];

  const labeledLines = description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(date|time(?: window)?|location|address):\s*(.+)$/i);

      if (!match) return null;

      return {
        label: normalizePickupSummaryLabel(match[1]),
        value: match[2].trim(),
      };
    })
    .filter((line): line is { label: string; value: string } => Boolean(line));

  if (labeledLines.length > 0) return labeledLines;

  return [{ label: "Details", value: description }];
}

function normalizePickupSummaryLabel(label: string) {
  const normalized = label.toLowerCase();

  if (normalized.startsWith("time")) return "Time";
  if (normalized === "address") return "Address";
  if (normalized === "location") return "Location";

  return "Date";
}

function buildPolicySections(store: StorefrontHome) {
  const sections: Array<{ body: string; title: string }> = [];

  addPolicySection(sections, "Pickup policy", store.pickup_policy);
  addPolicySection(sections, "Cancellation policy", store.cancellation_policy);
  addPolicySection(sections, "Other policies", store.other_policies);

  if (Array.isArray(store.custom_policies)) {
    for (const policy of store.custom_policies) {
      addPolicySection(sections, policy.title, policy.body);
    }
  }

  return sections;
}

function addPolicySection(
  sections: Array<{ body: string; title: string }>,
  title: string | null | undefined,
  body: string | null | undefined,
) {
  const trimmedTitle = title?.trim();
  const trimmedBody = body?.trim();

  if (!trimmedTitle || !trimmedBody) return;

  sections.push({ body: trimmedBody, title: trimmedTitle });
}

function getPolicySummary(store: StorefrontHome) {
  const summaryParts = [
    store.pickup_instructions?.trim(),
    store.pickup_policy?.trim(),
  ].filter(Boolean) as string[];

  if (summaryParts.length > 0) {
    return previewText(summaryParts.join("\n\n"), 280);
  }

  return "The seller will confirm pickup details after your order is placed.";
}

function previewText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;

  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function getFocusableElements(root: HTMLElement | null) {
  if (!root) return [];

  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true",
  );
}
