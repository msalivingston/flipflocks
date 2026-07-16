"use client";

import { SellerCard } from "../../_components/seller-ui";
import { formatDeliveryOptionLabel } from "../_lib/order-form-fulfillment";
import type {
  DeliveryAddress,
  DeliveryOption,
  FulfillmentMethod,
  PickupOption,
} from "../_lib/order-form-types";

export function OrderFulfillmentSection({
  buyerNotes,
  canUseDelivery,
  currentFulfillmentMethod,
  deliveryAddress,
  deliveryOptions,
  deliveryOptionId,
  onBuyerNotesChange,
  onDeliveryAddressChange,
  onDeliveryOptionChange,
  onFulfillmentMethodChange,
  onPickupNoteChange,
  onPickupOptionChange,
  pickupNote,
  pickupOptionId,
  pickupOptions,
  usesConfiguredPickupOptions,
}: {
  buyerNotes: string;
  canUseDelivery: boolean;
  currentFulfillmentMethod: FulfillmentMethod;
  deliveryAddress: DeliveryAddress;
  deliveryOptions: DeliveryOption[];
  deliveryOptionId: string;
  onBuyerNotesChange: (notes: string) => void;
  onDeliveryAddressChange: (updates: Partial<DeliveryAddress>) => void;
  onDeliveryOptionChange: (deliveryOptionId: string) => void;
  onFulfillmentMethodChange: (method: FulfillmentMethod) => void;
  onPickupNoteChange: (note: string) => void;
  onPickupOptionChange: (pickupOptionId: string) => void;
  pickupNote: string;
  pickupOptionId: string;
  pickupOptions: PickupOption[];
  usesConfiguredPickupOptions: boolean;
}) {
  return (
    <SellerCard className="min-w-0 p-3">
      <h2 className="text-lg font-semibold text-stone-950">Order Details</h2>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold text-stone-700">
          Fulfillment method
          <select
            className="seller-form-field seller-compact-field"
            value={currentFulfillmentMethod}
            onChange={(event) =>
              onFulfillmentMethodChange(event.target.value as FulfillmentMethod)
            }
          >
            <option value="pickup">Pickup</option>
            {canUseDelivery ? <option value="delivery">Delivery</option> : null}
          </select>
        </label>

        {currentFulfillmentMethod === "pickup" && usesConfiguredPickupOptions ? (
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Pickup option
            <select
              className="seller-form-field seller-compact-field"
              value={pickupOptionId}
              onChange={(event) => onPickupOptionChange(event.target.value)}
            >
              <option value="">Choose pickup option</option>
              {pickupOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {currentFulfillmentMethod === "pickup" && !usesConfiguredPickupOptions ? (
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Pickup note
            <input
              className="seller-form-field seller-compact-field"
              placeholder="Optional pickup details"
              value={pickupNote}
              onChange={(event) => onPickupNoteChange(event.target.value)}
            />
          </label>
        ) : null}

        {currentFulfillmentMethod === "delivery" ? (
          <>
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Delivery option
              <select
                className="seller-form-field seller-compact-field"
                value={deliveryOptionId}
                onChange={(event) => onDeliveryOptionChange(event.target.value)}
              >
                <option value="">Choose delivery option</option>
                {deliveryOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {formatDeliveryOptionLabel(option)}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-2 md:col-span-2 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_7rem_7rem]">
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Delivery address
                <input
                  className="seller-form-field seller-compact-field"
                  placeholder="Street address"
                  value={deliveryAddress.line1}
                  onChange={(event) =>
                    onDeliveryAddressChange({ line1: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Apt / unit
                <input
                  className="seller-form-field seller-compact-field"
                  placeholder="Optional"
                  value={deliveryAddress.line2}
                  onChange={(event) =>
                    onDeliveryAddressChange({ line2: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                City
                <input
                  className="seller-form-field seller-compact-field"
                  value={deliveryAddress.city}
                  onChange={(event) =>
                    onDeliveryAddressChange({ city: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                State
                <input
                  className="seller-form-field seller-compact-field"
                  value={deliveryAddress.state}
                  onChange={(event) =>
                    onDeliveryAddressChange({ state: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                ZIP
                <input
                  className="seller-form-field seller-compact-field"
                  value={deliveryAddress.postalCode}
                  onChange={(event) =>
                    onDeliveryAddressChange({ postalCode: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Country
                <input
                  className="seller-form-field seller-compact-field"
                  value={deliveryAddress.country}
                  onChange={(event) =>
                    onDeliveryAddressChange({ country: event.target.value })
                  }
                />
              </label>
            </div>
          </>
        ) : null}

        <label className="grid gap-1 text-sm font-semibold text-stone-700 md:col-span-2">
          Customer note
          <textarea
            className="seller-form-field seller-compact-field min-h-16 resize-y py-2"
            placeholder="Add a note for this order"
            value={buyerNotes}
            onChange={(event) => onBuyerNotesChange(event.target.value)}
          />
        </label>
      </div>
    </SellerCard>
  );
}
