import type { Dispatch, SetStateAction } from "react";
import { formatCurrency } from "../order-formatters";
import type { DeliveryAddress, DeliveryOption } from "./order-form-types";

export const emptyDeliveryAddress = (): DeliveryAddress => ({
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "US",
});

export function updateDeliveryAddress(
  setDeliveryAddress: Dispatch<SetStateAction<DeliveryAddress>>,
  updates: Partial<DeliveryAddress>,
  markEdited: () => void,
) {
  markEdited();
  setDeliveryAddress((current) => ({ ...current, ...updates }));
}

export function formatSavedDeliveryAddress(
  customer: {
    delivery_address_line1: string | null;
    delivery_address_line2: string | null;
    delivery_city: string | null;
    delivery_state: string | null;
    delivery_postal_code: string | null;
    delivery_country: string | null;
  } | null,
): DeliveryAddress {
  return {
    line1: customer?.delivery_address_line1 ?? "",
    line2: customer?.delivery_address_line2 ?? "",
    city: customer?.delivery_city ?? "",
    state: customer?.delivery_state ?? "",
    postalCode: customer?.delivery_postal_code ?? "",
    country: customer?.delivery_country ?? "US",
  };
}

export function formatDeliveryOptionLabel(option: DeliveryOption) {
  return `${option.name} - ${formatCurrency(option.price_amount ?? 0)}`;
}
