"use client";

import Image from "next/image";
import Link from "next/link";
import {
  FormEvent,
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  loadStorefrontDeliveryOptions,
  loadStorefrontPickupOptions,
  type StorefrontDeliveryOption,
  type StorefrontHome,
  type StorefrontPickupOption,
} from "../storefront-data";
import {
  StorefrontButton,
  StorefrontCard,
  StorefrontInput,
  StorefrontLabel,
  StorefrontPage,
  StorefrontSummaryCard,
  StorefrontTextarea,
  cx,
  formatCurrency,
  formatDate,
  toPublicImageUrl,
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
  fulfillmentMethod: FulfillmentMethod;
  deliveryOptionId: string;
};

type FulfillmentMethod = "pickup" | "delivery";
type CheckoutStep = "contact" | "fulfillment" | "review";

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
  fulfillmentMethod: "pickup",
  deliveryOptionId: "",
};

const emptyCartItems: StorefrontCart["items"] = [];

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
  const [deliveryOptions, setDeliveryOptions] = useState<
    StorefrontDeliveryOption[]
  >([]);
  const [isChecking, setIsChecking] = useState(false);
  const [isLoadingPickupOptions, setIsLoadingPickupOptions] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [activeStep, setActiveStep] = useState<CheckoutStep>("contact");
  const [completedSteps, setCompletedSteps] = useState<
    Record<CheckoutStep, boolean>
  >({
    contact: false,
    fulfillment: false,
    review: false,
  });
  const [isMobileOrderSummaryOpen, setIsMobileOrderSummaryOpen] =
    useState(false);
  const contactStepRef = useRef<HTMLElement | null>(null);
  const fulfillmentStepRef = useRef<HTMLElement | null>(null);
  const reviewStepRef = useRef<HTMLElement | null>(null);

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

  useEffect(() => {
    let isActive = true;

    loadStorefrontDeliveryOptions(store.store_slug).then((result) => {
      if (!isActive) return;

      if (result.error) {
        setDeliveryOptions([]);
        setForm((current) =>
          current.fulfillmentMethod === "delivery"
            ? {
                ...current,
                deliveryOptionId: "",
                fulfillmentMethod: "pickup",
              }
            : { ...current, deliveryOptionId: "" },
        );
        return;
      }

      setDeliveryOptions(result.data);
      setForm((current) => {
        if (result.data.length === 0 && current.fulfillmentMethod === "delivery") {
          return {
            ...current,
            deliveryOptionId: "",
            fulfillmentMethod: "pickup",
          };
        }

        const deliveryOptionStillExists = result.data.some(
          (option) => option.delivery_option_id === current.deliveryOptionId,
        );

        if (current.deliveryOptionId && !deliveryOptionStillExists) {
          return { ...current, deliveryOptionId: "" };
        }

        return current;
      });
    });

    return () => {
      isActive = false;
    };
  }, [store.store_slug]);

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
  const itemSubtotal = validatedSubtotal ?? cartSummary.subtotal;
  const deliveryAvailable = deliveryOptions.length > 0;
  const selectedDeliveryOption =
    form.fulfillmentMethod === "delivery"
      ? deliveryOptions.find(
          (option) => option.delivery_option_id === form.deliveryOptionId,
        ) ?? null
      : null;
  const selectedDeliveryFee = selectedDeliveryOption?.price_amount ?? 0;
  const estimatedTotal = itemSubtotal + selectedDeliveryFee;
  const selectedPickupOption =
    form.fulfillmentMethod === "pickup" && usesManualPickupOptions
      ? pickupOptions.find(
          (option) => option.pickup_option_id === form.pickupOptionId,
        ) ?? null
      : null;
  const activeStepActionLabel =
    activeStep === "contact"
      ? "Continue to pickup"
      : activeStep === "fulfillment"
        ? "Continue to review"
        : isSubmitting
          ? "Placing order..."
          : "Place order";
  const activeStepAction =
    activeStep === "contact"
      ? handleContactContinue
      : activeStep === "fulfillment"
        ? handleFulfillmentContinue
        : handleReviewSubmit;
  const activeStepDisabled =
    isSubmitting ||
    isChecking ||
    isLoadingPickupOptions ||
    checkoutItems.length === 0 ||
    summary?.is_checkout_available === false;

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
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function chooseFulfillmentMethod(method: FulfillmentMethod) {
    setErrorMessage(null);
    setForm((current) => {
      if (method === "pickup") {
        return {
          ...current,
          deliveryOptionId: "",
          fulfillmentMethod: "pickup",
        };
      }

      return {
        ...current,
        deliveryOptionId: "",
        fulfillmentMethod: "delivery",
        pickupNote: "",
        pickupOptionId: "",
      };
    });
  }

  function handleClearCart() {
    clearStorefrontCart(store.store_slug);
    setCart(readStorefrontCart(store.store_slug));
    setSummary(null);
    setSummaryMessage(null);
    setErrorMessage(null);
  }

  function focusCheckoutField(name: keyof BuyerForm) {
    window.setTimeout(() => {
      const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        `[name="${name}"]`,
      );
      field?.focus();
      field?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
  }

  function scrollStepIntoView(step: CheckoutStep) {
    const ref =
      step === "contact"
        ? contactStepRef
        : step === "fulfillment"
          ? fulfillmentStepRef
          : reviewStepRef;

    window.setTimeout(() => {
      ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 0);
  }

  function openStep(step: CheckoutStep) {
    setActiveStep(step);
    scrollStepIntoView(step);
  }

  function validateContactStep() {
    const requiredFields: Array<keyof BuyerForm> = [
      "buyerFirstName",
      "buyerLastName",
      "buyerEmail",
      "buyerPhone",
    ];
    const missingField = requiredFields.find((field) => !form[field].trim());

    if (missingField) {
      setErrorMessage("Please complete your contact information.");
      setActiveStep("contact");
      focusCheckoutField(missingField);
      return false;
    }

    return true;
  }

  function validateFulfillmentStep() {
    if (
      form.fulfillmentMethod === "pickup" &&
      usesManualPickupOptions &&
      !form.pickupOptionId
    ) {
      setErrorMessage("Please choose a pickup option.");
      setActiveStep("fulfillment");
      focusCheckoutField("pickupOptionId");
      return false;
    }

    if (form.fulfillmentMethod === "delivery") {
      if (!form.deliveryOptionId) {
        setErrorMessage("Please choose a delivery option.");
        setActiveStep("fulfillment");
        focusCheckoutField("deliveryOptionId");
        return false;
      }

      const missingAddressField = (
        ["addressLine1", "city", "state", "postalCode"] as Array<keyof BuyerForm>
      ).find((field) => !form[field].trim());

      if (missingAddressField) {
        setErrorMessage("Please complete your delivery address.");
        setActiveStep("fulfillment");
        focusCheckoutField(missingAddressField);
        return false;
      }
    }

    return true;
  }

  function handleContactContinue() {
    setErrorMessage(null);
    if (!validateContactStep()) return;

    setCompletedSteps((current) => ({ ...current, contact: true }));
    setActiveStep("fulfillment");
    scrollStepIntoView("fulfillment");
  }

  function handleFulfillmentContinue() {
    setErrorMessage(null);
    if (!validateFulfillmentStep()) return;

    setCompletedSteps((current) => ({ ...current, fulfillment: true }));
    setActiveStep("review");
    scrollStepIntoView("review");
  }

  function handleReviewSubmit() {
    setErrorMessage(null);
    if (!validateContactStep()) return;
    if (!validateFulfillmentStep()) return;

    setCompletedSteps((current) => ({
      ...current,
      contact: true,
      fulfillment: true,
      review: true,
    }));
    void submitOrder();
  }

  async function submitOrder() {
    setErrorMessage(null);

    if (checkoutItems.length === 0) {
      setErrorMessage("Your cart is empty.");
      return;
    }

    if (summary && !summary.is_checkout_available) {
      setErrorMessage(toBuyerOrderError(summary.message ?? undefined));
      return;
    }

    if (
      form.fulfillmentMethod === "pickup" &&
      usesManualPickupOptions &&
      !form.pickupOptionId
    ) {
      setErrorMessage("Please choose a pickup option.");
      return;
    }

    if (form.fulfillmentMethod === "delivery" && !form.deliveryOptionId) {
      setErrorMessage("Please choose a delivery option.");
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
      fulfillment_method: form.fulfillmentMethod,
      pickup_note:
        form.fulfillmentMethod === "pickup"
          ? form.pickupNote.trim() || null
          : null,
      pickup_option_id:
        form.fulfillmentMethod === "pickup" && usesManualPickupOptions
          ? form.pickupOptionId
          : null,
      ...(form.fulfillmentMethod === "delivery"
        ? { delivery_option_id: form.deliveryOptionId }
        : {}),
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitOrder();
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
    <StorefrontPage className="gap-4 pb-28 lg:pb-8">
      <div className="hidden rounded-xl border border-[#ded7c8] bg-white p-4 lg:block">
        <p className="storefront-primary-color text-xs font-semibold uppercase tracking-[0.12em] text-emerald-800">
          Checkout
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          Place your order
        </h1>
        <p className="mt-1 text-sm leading-5 text-stone-600">
          Enter your contact details once and review your order summary.
        </p>
      </div>

      {cart === null ? (
        <CheckoutPanel>
          <p className="text-sm text-stone-600">Loading checkout...</p>
        </CheckoutPanel>
      ) : cartItems.length === 0 ? (
        <CheckoutPanel>
          <h2 className="text-xl font-semibold text-stone-950">
            Your cart is empty
          </h2>
          <p className="mt-1.5 text-sm leading-5 text-stone-600">
            Add available options before checkout.
          </p>
          <StorefrontButton className="mt-3 min-h-10" href={`/store/${store.store_slug}`}>
            Continue shopping
          </StorefrontButton>
        </CheckoutPanel>
      ) : (
        <>
        <div className="grid gap-3 lg:hidden">
          <section>
            <h1 className="text-[2.15rem] font-bold leading-tight text-stone-950">
              Checkout
            </h1>
            <p className="mt-1 text-base text-stone-600">{store.store_name}</p>
          </section>

          <CheckoutProgress
            activeStep={activeStep}
            completedSteps={completedSteps}
            onStepSelect={openStep}
          />

          <MobileOrderSummary
            cartItems={cartItems}
            estimatedTotal={estimatedTotal}
            isOpen={isMobileOrderSummaryOpen}
            onToggle={() =>
              setIsMobileOrderSummaryOpen((current) => !current)
            }
            storeSlug={store.store_slug}
            totalQuantity={cartSummary.totalQuantity}
          />

          <MobileCheckoutStep
            index={1}
            isComplete={completedSteps.contact}
            isOpen={activeStep === "contact"}
            onToggle={() => openStep("contact")}
            ref={contactStepRef}
            summary={getContactSummary(form)}
            title="Contact information"
          >
            <p className="text-base leading-6 text-stone-600">
              We&apos;ll use this to send your order updates.
            </p>
            <div className="mt-4 grid gap-3">
              <div className="grid gap-3 min-[380px]:grid-cols-2">
                <TextField
                  autoComplete="given-name"
                  label="First name"
                  name="buyerFirstName"
                  onChange={(value) => updateField("buyerFirstName", value)}
                  value={form.buyerFirstName}
                />
                <TextField
                  autoComplete="family-name"
                  label="Last name"
                  name="buyerLastName"
                  onChange={(value) => updateField("buyerLastName", value)}
                  value={form.buyerLastName}
                />
              </div>
              <TextField
                autoComplete="email"
                label="Email"
                name="buyerEmail"
                onChange={(value) => updateField("buyerEmail", value)}
                type="email"
                value={form.buyerEmail}
              />
              <TextField
                autoComplete="tel"
                label="Phone"
                name="buyerPhone"
                onChange={(value) => updateField("buyerPhone", value)}
                type="tel"
                value={form.buyerPhone}
              />
              <TextArea
                label="Notes for seller (optional)"
                name="buyerNotes"
                onChange={(value) => updateField("buyerNotes", value)}
                required={false}
                value={form.buyerNotes}
              />
              {errorMessage && activeStep === "contact" ? (
                <MobileError>{errorMessage}</MobileError>
              ) : null}
              <StorefrontButton
                className="min-h-12 w-full text-base"
                onClick={handleContactContinue}
              >
                Continue to pickup
              </StorefrontButton>
            </div>
          </MobileCheckoutStep>

          <MobileCheckoutStep
            index={2}
            isComplete={completedSteps.fulfillment}
            isOpen={activeStep === "fulfillment"}
            onToggle={() => openStep("fulfillment")}
            ref={fulfillmentStepRef}
            summary={getFulfillmentSummary({
              deliveryOption: selectedDeliveryOption,
              form,
              pickupOption: selectedPickupOption,
              usesManualPickupOptions,
            })}
            title="Pickup or delivery"
          >
            <p className="text-base leading-6 text-stone-600">
              Choose how you&apos;d like to receive your order.
            </p>
            <div className="mt-4 grid gap-3">
              {deliveryAvailable ? (
                <div className="grid gap-2">
                  <FulfillmentChoice
                    checked={form.fulfillmentMethod === "pickup"}
                    description="The farm will confirm the exact pickup time and instructions by email."
                    label="Pickup"
                    onChange={() => chooseFulfillmentMethod("pickup")}
                  />
                  <FulfillmentChoice
                    checked={form.fulfillmentMethod === "delivery"}
                    description="Choose one of this seller's delivery options."
                    label="Delivery"
                    onChange={() => chooseFulfillmentMethod("delivery")}
                  />
                </div>
              ) : (
                <div className="rounded-lg border border-[#e7decd] bg-[#fffdf8] p-3">
                  <p className="font-bold text-stone-950">Pickup</p>
                  <p className="mt-1 text-sm leading-5 text-stone-600">
                    The farm will confirm the exact pickup time and instructions by email.
                  </p>
                </div>
              )}

              {form.fulfillmentMethod === "pickup" &&
              usesManualPickupOptions ? (
                <label className="grid gap-1.5 text-sm font-bold text-stone-900">
                  Pickup choice
                  <select
                    className="min-h-11 rounded-md border border-[#ded7c8] bg-white px-3 text-base text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                    disabled={isLoadingPickupOptions}
                    name="pickupOptionId"
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
              ) : null}

              {form.fulfillmentMethod === "delivery" ? (
                <>
                  <label className="grid gap-1.5 text-sm font-bold text-stone-900">
                    Delivery option
                    <select
                      className="min-h-11 rounded-md border border-[#ded7c8] bg-white px-3 text-base text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                      name="deliveryOptionId"
                      onChange={(event) =>
                        updateField("deliveryOptionId", event.target.value)
                      }
                      required
                      value={form.deliveryOptionId}
                    >
                      <option value="">Choose a delivery option</option>
                      {deliveryOptions.map((option) => (
                        <option
                          key={option.delivery_option_id}
                          value={option.delivery_option_id}
                        >
                          {formatDeliveryOptionLabel(option)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <TextField
                    autoComplete="address-line1"
                    label="Address line 1"
                    name="addressLine1"
                    onChange={(value) => updateField("addressLine1", value)}
                    value={form.addressLine1}
                  />
                  <TextField
                    autoComplete="address-line2"
                    label="Address line 2"
                    name="addressLine2"
                    onChange={(value) => updateField("addressLine2", value)}
                    required={false}
                    value={form.addressLine2}
                  />
                  <TextField
                    autoComplete="address-level2"
                    label="City"
                    name="city"
                    onChange={(value) => updateField("city", value)}
                    value={form.city}
                  />
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                    <TextField
                      autoComplete="address-level1"
                      label="State"
                      maxLength={40}
                      name="state"
                      onChange={(value) => updateField("state", value)}
                      value={form.state}
                    />
                    <TextField
                      autoComplete="postal-code"
                      label="ZIP"
                      maxLength={20}
                      name="postalCode"
                      onChange={(value) => updateField("postalCode", value)}
                      value={form.postalCode}
                    />
                  </div>
                </>
              ) : null}

              {form.fulfillmentMethod === "pickup" &&
              store.pickup_method === "notes" ? (
                <TextArea
                  label="Pickup notes"
                  name="pickupNote"
                  onChange={(value) => updateField("pickupNote", value)}
                  required={false}
                  value={form.pickupNote}
                />
              ) : null}

              <details className="rounded-lg bg-[#fbf7ef] px-3 py-2 text-sm leading-5 text-stone-600">
                <summary className="cursor-pointer font-bold text-stone-900">
                  View policies
                </summary>
                <div className="mt-2 grid gap-2 whitespace-pre-line">
                  <p>{store.pickup_instructions || "Pickup details coming soon."}</p>
                  {store.pickup_policy ? <p>{store.pickup_policy}</p> : null}
                  {store.cancellation_policy ? (
                    <p>{store.cancellation_policy}</p>
                  ) : null}
                </div>
              </details>

              {pickupOptionsError ? (
                <MobileError>
                  Pickup choices could not load. Please refresh and try again.
                </MobileError>
              ) : null}
              {errorMessage && activeStep === "fulfillment" ? (
                <MobileError>{errorMessage}</MobileError>
              ) : null}
              <StorefrontButton
                className="min-h-12 w-full text-base"
                onClick={handleFulfillmentContinue}
              >
                Continue to review
              </StorefrontButton>
            </div>
          </MobileCheckoutStep>

          <MobileCheckoutStep
            index={3}
            isComplete={completedSteps.review}
            isOpen={activeStep === "review"}
            onToggle={() => openStep("review")}
            ref={reviewStepRef}
            summary="Confirm your details and place your order."
            title="Review your order"
          >
            <div className="grid gap-3">
              <ReviewBlock title="Contact" onEdit={() => openStep("contact")}>
                <p>{getContactSummary(form) || "Contact details needed"}</p>
                {form.buyerPhone ? <p>{form.buyerPhone}</p> : null}
              </ReviewBlock>
              <ReviewBlock
                title={form.fulfillmentMethod === "delivery" ? "Delivery" : "Pickup"}
                onEdit={() => openStep("fulfillment")}
              >
                <p>
                  {getFulfillmentSummary({
                    deliveryOption: selectedDeliveryOption,
                    form,
                    pickupOption: selectedPickupOption,
                    usesManualPickupOptions,
                  }) || "Fulfillment details needed"}
                </p>
              </ReviewBlock>
              <div className="rounded-lg border border-[#eee5d6] bg-[#fffdf8] p-3">
                <p className="font-bold text-stone-950">Order</p>
                <div className="mt-2 grid gap-2">
                  {cartItems.map((item) => (
                    <div className="text-sm" key={cartItemKey(item)}>
                      <div className="flex justify-between gap-3">
                        <p className="font-semibold text-stone-950">
                          {item.productName}
                        </p>
                        <p className="font-semibold text-stone-950">
                          {formatCurrency(item.unitPrice * item.quantity)}
                        </p>
                      </div>
                      <p className="text-stone-600">
                        {item.quantity} x {item.optionLabel} ·{" "}
                        {formatCurrency(item.unitPrice)} each
                      </p>
                    </div>
                  ))}
                </div>
                <dl className="mt-3 grid gap-1.5 border-t border-[#e7decd] pt-3 text-sm">
                  <SummaryRow
                    label="Subtotal"
                    value={formatCurrency(itemSubtotal)}
                  />
                  {selectedDeliveryOption ? (
                    <SummaryRow
                      label="Delivery"
                      value={formatDeliveryPrice(selectedDeliveryOption.price_amount)}
                    />
                  ) : null}
                  <SummaryRow
                    label="Total"
                    value={formatCurrency(estimatedTotal)}
                  />
                </dl>
              </div>
              <div className="rounded-lg bg-[#f3f8ef] p-3 text-sm leading-6 text-stone-700">
                <p className="font-bold text-stone-950">
                  No payment is collected online.
                </p>
                <p>You will pay the seller according to their store policies.</p>
                <p>You will receive an email confirmation after placing your order.</p>
              </div>
              {summaryMessage ? (
                <MobileError>{toBuyerOrderError(summaryMessage)}</MobileError>
              ) : null}
              {errorMessage && activeStep === "review" ? (
                <MobileError>{errorMessage}</MobileError>
              ) : null}
              <StorefrontButton
                className="min-h-12 w-full text-base"
                disabled={activeStepDisabled}
                onClick={handleReviewSubmit}
              >
                {isSubmitting ? "Placing order..." : "Place order"}
              </StorefrontButton>
            </div>
          </MobileCheckoutStep>

          <MobileStickyCheckoutBar
            actionLabel={activeStepActionLabel}
            disabled={activeStepDisabled}
            itemCount={cartSummary.totalQuantity}
            onAction={activeStepAction}
            total={estimatedTotal}
          />
        </div>

        <div className="hidden gap-4 lg:grid lg:grid-cols-[1fr_21rem] lg:items-start">
          <form
            className="rounded-xl border border-[#ded7c8] bg-white p-4"
            id="storefront-checkout-form"
            onSubmit={handleSubmit}
          >
            <p className="storefront-primary-color text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">
              Buyer details
            </p>
            <h2 className="mt-1.5 text-xl font-semibold text-stone-950">
              Contact and pickup information
            </h2>
            <div className="mt-3 grid gap-2.5">
              <div className="grid gap-2.5 sm:grid-cols-2">
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

              {deliveryAvailable ? (
                <section className="border-t border-[#eee5d6] pt-3">
                  <h2 className="text-lg font-semibold text-stone-950">
                    How would you like to receive your order?
                  </h2>
                  <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
                    <FulfillmentChoice
                      checked={form.fulfillmentMethod === "pickup"}
                      description="Use this seller's pickup process."
                      label="Pickup"
                      onChange={() => chooseFulfillmentMethod("pickup")}
                    />
                    <FulfillmentChoice
                      checked={form.fulfillmentMethod === "delivery"}
                      description="Choose one of this seller's delivery options."
                      label="Delivery"
                      onChange={() => chooseFulfillmentMethod("delivery")}
                    />
                  </div>
                </section>
              ) : null}

              <h2 className="border-t border-[#eee5d6] pt-3 text-lg font-semibold text-stone-950">
                {form.fulfillmentMethod === "delivery"
                  ? "Delivery details"
                  : "Pickup details"}
              </h2>
              {form.fulfillmentMethod === "pickup" &&
              usesManualPickupOptions ? (
                <label className="grid gap-1 text-xs font-semibold text-stone-800">
                  Pickup choice
                  <select
                    className="min-h-10 rounded-md border border-[#ded7c8] bg-white px-3 text-sm text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
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
                  <span className="text-xs font-medium leading-4 text-stone-500">
                    Choose a pickup option from this seller.
                  </span>
                </label>
              ) : null}
              {form.fulfillmentMethod === "delivery" ? (
                <label className="grid gap-1 text-xs font-semibold text-stone-800">
                  Choose a delivery option
                  <select
                    className="min-h-10 rounded-md border border-[#ded7c8] bg-white px-3 text-sm text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                    onChange={(event) =>
                      updateField("deliveryOptionId", event.target.value)
                    }
                    required
                    value={form.deliveryOptionId}
                  >
                    <option value="">Choose a delivery option</option>
                    {deliveryOptions.map((option) => (
                      <option
                        key={option.delivery_option_id}
                        value={option.delivery_option_id}
                      >
                        {formatDeliveryOptionLabel(option)}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs font-medium leading-4 text-stone-500">
                    We will be in touch to coordinate your delivery.
                  </span>
                </label>
              ) : null}
              {form.fulfillmentMethod === "pickup" && pickupOptionsError ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
                  Pickup choices could not load. Please refresh and try again.
                </p>
              ) : null}
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
              <div className="grid gap-2.5">
                <TextField
                  label="City"
                  name="city"
                  onChange={(value) => updateField("city", value)}
                  value={form.city}
                />
                <div className="grid gap-2.5 sm:grid-cols-[minmax(0,8rem)_minmax(0,10rem)]">
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
              </div>

              <TextArea
                label="Notes for the seller"
                name="buyerNotes"
                onChange={(value) => updateField("buyerNotes", value)}
                value={form.buyerNotes}
              />
              {form.fulfillmentMethod === "pickup" &&
              store.pickup_method === "notes" ? (
                <TextArea
                  label="Pickup notes"
                  name="pickupNote"
                  onChange={(value) => updateField("pickupNote", value)}
                  value={form.pickupNote}
                />
              ) : null}

              {errorMessage ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-800">
                  {errorMessage}
                </div>
              ) : null}

            </div>
          </form>

          <aside className="grid h-fit gap-2.5 lg:sticky lg:top-28">
            <StorefrontSummaryCard>
              <p className="storefront-primary-color text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">
                Order summary
              </p>
              <h2 className="mt-1.5 text-xl font-semibold text-stone-950">
                Your order
              </h2>
              <div className="mt-2.5 grid gap-1.5">
                {cartItems.map((item) => (
                  <div
                    className="rounded-lg border border-[#eee5d6] bg-[#fffdf8] p-2 text-sm"
                    key={cartItemKey(item)}
                  >
                    <div className="flex justify-between gap-3">
                      <p className="font-semibold text-stone-950">
                        {item.productName}
                      </p>
                      <p className="font-semibold text-stone-950">
                        {formatCurrency(item.unitPrice * item.quantity)}
                      </p>
                    </div>
                    <p className="mt-0.5 text-xs text-stone-600">
                      {item.quantity} x {item.optionLabel}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      {formatCartAvailability(item.availableDate)}
                    </p>
                  </div>
                ))}
              </div>
              <dl className="mt-3 grid gap-1.5 text-sm">
                <SummaryRow
                  label="Items"
                  value={String(summary?.total_quantity ?? cartSummary.totalQuantity)}
                />
                {selectedDeliveryOption ? (
                  <SummaryRow
                    label={`Delivery — ${selectedDeliveryOption.name}`}
                    value={formatDeliveryPrice(selectedDeliveryOption.price_amount)}
                  />
                ) : null}
                <SummaryRow
                  label="Estimated total"
                  value={formatCurrency(estimatedTotal)}
                />
              </dl>
              {isChecking ? (
                <p className="mt-2 text-sm text-stone-500">
                  Checking availability...
                </p>
              ) : null}
              {summaryMessage ? (
                <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {toBuyerOrderError(summaryMessage)}
                </p>
              ) : null}
              <StorefrontButton
                className="mt-3 min-h-10 w-full"
                disabled={
                  isSubmitting ||
                  isChecking ||
                  isLoadingPickupOptions ||
                  checkoutItems.length === 0 ||
                  summary?.is_checkout_available === false ||
                  (form.fulfillmentMethod === "pickup" &&
                    usesManualPickupOptions &&
                    !form.pickupOptionId) ||
                  (form.fulfillmentMethod === "delivery" &&
                    !form.deliveryOptionId)
                }
                form="storefront-checkout-form"
                type="submit"
              >
                {isSubmitting ? "Placing order..." : "Place order"}
              </StorefrontButton>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <StorefrontButton
                  className="min-h-10 w-full px-3 text-sm"
                  href={`/store/${store.store_slug}/cart`}
                  variant="secondary"
                >
                  View cart
                </StorefrontButton>
                <StorefrontButton
                  className="min-h-10 w-full px-3 text-sm"
                  disabled={isSubmitting}
                  onClick={handleClearCart}
                  variant="secondary"
                >
                  Clear cart
                </StorefrontButton>
              </div>

            </StorefrontSummaryCard>

            <StorefrontSummaryCard className="bg-[#fffdf8]">
              <h2 className="text-base font-semibold text-stone-950">
                Pickup and policies
              </h2>
              <div className="mt-2 grid gap-1.5 whitespace-pre-line text-xs leading-5 text-stone-600">
                <p>{store.pickup_instructions || "Pickup details coming soon."}</p>
                {store.pickup_policy ? <p>{store.pickup_policy}</p> : null}
                {store.cancellation_policy ? (
                  <p>{store.cancellation_policy}</p>
                ) : null}
              </div>
            </StorefrontSummaryCard>
          </aside>
        </div>
        </>
      )}
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

function CheckoutProgress({
  activeStep,
  completedSteps,
  onStepSelect,
}: {
  activeStep: CheckoutStep;
  completedSteps: Record<CheckoutStep, boolean>;
  onStepSelect: (step: CheckoutStep) => void;
}) {
  const steps: Array<{ id: CheckoutStep; index: number; label: string }> = [
    { id: "contact", index: 1, label: "Contact" },
    { id: "fulfillment", index: 2, label: "Pickup" },
    { id: "review", index: 3, label: "Review" },
  ];

  return (
    <ol className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 text-sm">
      {steps.map((step, index) => {
        const isActive = activeStep === step.id;
        const isComplete = completedSteps[step.id];

        return (
          <li
            aria-current={isActive ? "step" : undefined}
            className="contents"
            key={step.id}
          >
            <button
              aria-label={`Go to ${step.label} step${isComplete ? ", completed" : ""}`}
              className="flex min-h-10 min-w-0 items-center justify-center gap-1.5 rounded-md px-1 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
              onClick={() => onStepSelect(step.id)}
              type="button"
            >
              <span
                className={cx(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold",
                  isActive
                    ? "storefront-primary-button border-transparent text-white"
                    : isComplete
                      ? "storefront-primary-color border-emerald-700 bg-emerald-50 text-[#073f1e]"
                      : "border-[#d7d0c4] bg-white text-stone-600",
                )}
              >
                {step.index}
              </span>
              <span
                className={cx(
                  "truncate font-semibold",
                  isActive || isComplete ? "text-stone-950" : "text-stone-600",
                )}
              >
                {step.label}
              </span>
            </button>
            {index < steps.length - 1 ? (
              <div className="h-px w-6 bg-[#d7d0c4]" aria-hidden="true" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function MobileOrderSummary({
  cartItems,
  estimatedTotal,
  isOpen,
  onToggle,
  storeSlug,
  totalQuantity,
}: {
  cartItems: StorefrontCartItem[];
  estimatedTotal: number;
  isOpen: boolean;
  onToggle: () => void;
  storeSlug: string;
  totalQuantity: number;
}) {
  const firstItem = cartItems[0] ?? null;

  return (
    <section className="rounded-xl border border-[#ded7c8] bg-white p-3 shadow-[0_2px_12px_rgba(41,37,36,0.04)]">
      <button
        aria-expanded={isOpen}
        className="flex min-h-14 w-full items-center gap-3 text-left"
        onClick={onToggle}
        type="button"
      >
        {firstItem?.imageUrl ? (
          <Image
            alt=""
            className="h-14 w-14 rounded-md object-cover"
            height={96}
            src={toPublicImageUrl(firstItem.imageUrl)}
            unoptimized
            width={96}
          />
        ) : (
          <div className="h-14 w-14 rounded-md bg-[#f4eee3]" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-bold text-stone-950">
            Your order · {formatCurrency(estimatedTotal)}
          </span>
          <span className="block text-sm text-stone-600">
            {totalQuantity} item{totalQuantity === 1 ? "" : "s"}
          </span>
        </span>
        <span className="storefront-primary-color text-sm font-bold text-[#073f1e]">
          {isOpen ? "Hide" : "View"}
        </span>
      </button>
      {isOpen ? (
        <div className="mt-3 grid gap-2 border-t border-[#eee5d6] pt-3">
          {cartItems.map((item) => (
            <div className="text-sm" key={cartItemKey(item)}>
              <div className="flex justify-between gap-3">
                <p className="font-semibold text-stone-950">
                  {item.productName}
                </p>
                <p className="font-semibold text-stone-950">
                  {formatCurrency(item.unitPrice * item.quantity)}
                </p>
              </div>
              <p className="text-stone-600">
                {item.quantity} x {item.optionLabel}
              </p>
            </div>
          ))}
          <Link
            className="storefront-primary-color mt-1 w-fit rounded-md text-sm font-bold text-[#073f1e] focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            href={`/store/${storeSlug}/cart`}
          >
            Edit cart
          </Link>
        </div>
      ) : null}
    </section>
  );
}

const MobileCheckoutStep = forwardRef<
  HTMLElement,
  {
    children: React.ReactNode;
    index: number;
    isComplete: boolean;
    isOpen: boolean;
    onToggle: () => void;
    summary: string;
    title: string;
  }
>(function MobileCheckoutStep(
  { children, index, isComplete, isOpen, onToggle, summary, title },
  ref,
) {
  return (
    <section
      className="rounded-xl border border-[#ded7c8] bg-white p-3 shadow-[0_2px_12px_rgba(41,37,36,0.04)]"
      ref={ref}
    >
      <button
        aria-expanded={isOpen}
        className="flex w-full items-start gap-3 text-left"
        onClick={onToggle}
        type="button"
      >
        <span
          className={cx(
            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-base font-bold",
            isOpen
              ? "storefront-primary-button border-transparent text-white"
              : isComplete
                ? "storefront-primary-color border-emerald-700 bg-emerald-50 text-[#073f1e]"
                : "border-[#d7d0c4] bg-white text-stone-600",
          )}
        >
          {index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[1.35rem] font-bold leading-tight text-stone-950">
            {title}
          </span>
          <span className="mt-1 line-clamp-2 block text-base leading-6 text-stone-600">
            {isOpen ? summary : summary || "Not completed yet"}
          </span>
        </span>
        <span aria-hidden="true" className="pt-1 text-xl text-stone-950">
          {isOpen ? "⌃" : "⌄"}
        </span>
      </button>
      {isOpen ? <div className="mt-4">{children}</div> : null}
    </section>
  );
});

function ReviewBlock({
  children,
  onEdit,
  title,
}: {
  children: React.ReactNode;
  onEdit: () => void;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-[#eee5d6] bg-[#fffdf8] p-3 text-sm leading-6 text-stone-700">
      <div className="flex items-center justify-between gap-3">
        <p className="font-bold text-stone-950">{title}</p>
        <button
          className="storefront-primary-color rounded-md text-sm font-bold text-[#073f1e] focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
          onClick={onEdit}
          type="button"
        >
          Edit
        </button>
      </div>
      <div className="mt-1">{children}</div>
    </section>
  );
}

function MobileStickyCheckoutBar({
  actionLabel,
  disabled,
  itemCount,
  onAction,
  total,
}: {
  actionLabel: string;
  disabled: boolean;
  itemCount: number;
  onAction: () => void;
  total: number;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#ded7c8] bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgba(41,37,36,0.14)] backdrop-blur lg:hidden pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto grid max-w-[28rem] grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)] items-center gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-stone-600">Total</p>
          <p className="storefront-primary-color text-2xl font-bold leading-tight text-[#073f1e]">
            {formatCurrency(total)}
          </p>
          <p className="text-xs text-stone-500">
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </p>
        </div>
        <StorefrontButton
          className="min-h-12 w-full px-3 text-base"
          disabled={disabled}
          onClick={onAction}
        >
          {actionLabel}
        </StorefrontButton>
      </div>
    </div>
  );
}

function MobileError({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-800">
      {children}
    </div>
  );
}

function FulfillmentChoice({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: () => void;
}) {
  return (
    <label
      className={`grid cursor-pointer gap-1.5 rounded-lg border p-2.5 text-sm transition ${
        checked
          ? "border-emerald-700 bg-emerald-50/50 text-emerald-950"
          : "border-[#ded7c8] bg-white text-stone-700 hover:border-emerald-300"
      }`}
    >
      <span className="flex items-center gap-2 font-semibold">
        <input
          checked={checked}
          className="h-4 w-4 accent-emerald-800"
          name="fulfillmentMethod"
          onChange={onChange}
          type="radio"
        />
        {label}
      </span>
      <span className="text-xs font-medium leading-4 text-stone-600">
        {description}
      </span>
    </label>
  );
}

function TextField({
  autoComplete,
  label,
  maxLength,
  name,
  onChange,
  required = true,
  type = "text",
  value,
}: {
  autoComplete?: string;
  label: string;
  maxLength?: number;
  name: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: "email" | "tel" | "text";
  value: string;
}) {
  return (
    <StorefrontLabel className="min-w-0 gap-1.5 text-sm lg:gap-1 lg:text-xs">
      {label}
      <StorefrontInput
        autoComplete={autoComplete}
        className="min-h-11 w-full min-w-0 py-2 text-base lg:min-h-9 lg:py-1 lg:text-sm"
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
  label,
  name,
  onChange,
  required = false,
  value,
}: {
  label: string;
  name: string;
  onChange: (value: string) => void;
  required?: boolean;
  value: string;
}) {
  return (
    <StorefrontLabel className="gap-1.5 text-sm lg:gap-1 lg:text-xs">
      {label}
      <StorefrontTextarea
        className="min-h-24 py-2 text-base lg:min-h-16 lg:py-1 lg:text-sm"
        maxLength={2000}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        value={value}
      />
    </StorefrontLabel>
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

function getContactSummary(form: BuyerForm) {
  const name = [form.buyerFirstName.trim(), form.buyerLastName.trim()]
    .filter(Boolean)
    .join(" ");
  const details = [name, form.buyerEmail.trim()].filter(Boolean);

  return details.join(" · ");
}

function getFulfillmentSummary({
  deliveryOption,
  form,
  pickupOption,
  usesManualPickupOptions,
}: {
  deliveryOption: StorefrontDeliveryOption | null;
  form: BuyerForm;
  pickupOption: StorefrontPickupOption | null;
  usesManualPickupOptions: boolean;
}) {
  if (form.fulfillmentMethod === "delivery") {
    const address = [form.city.trim(), form.state.trim()].filter(Boolean).join(", ");
    return [
      "Delivery",
      deliveryOption?.name ?? null,
      address || null,
      deliveryOption ? formatDeliveryPrice(deliveryOption.price_amount) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  return [
    "Pickup",
    usesManualPickupOptions ? pickupOption?.label ?? null : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatDeliveryOptionLabel(option: StorefrontDeliveryOption) {
  return `${option.name} — ${formatDeliveryPrice(option.price_amount)}`;
}

function formatDeliveryPrice(price: number) {
  return price === 0 ? "Free" : formatCurrency(price);
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
    message === "Store does not offer delivery." ||
    message === "Delivery option is not available for this store." ||
    message === "Delivery option is required for delivery orders." ||
    message === "delivery_option_id must be a valid ID."
  ) {
    return "The selected delivery option is no longer available. Please choose another option.";
  }

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
