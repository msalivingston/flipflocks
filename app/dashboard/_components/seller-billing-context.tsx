"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  parseSellerBillingStatus,
  type SellerBillingStatus,
} from "@/lib/saas-billing-status";

type SellerBillingContextValue = {
  error: boolean;
  isLoading: boolean;
  reload: () => Promise<SellerBillingStatus | null>;
  status: SellerBillingStatus | null;
};

const SellerBillingContext = createContext<SellerBillingContextValue | null>(null);

export function SellerBillingStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SellerBillingStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    setError(false);
    const { data, error: requestError } = await supabase.rpc(
      "seller_get_saas_billing_status",
    );
    if (requestError) {
      setError(true);
      setIsLoading(false);
      return null;
    }
    const row = parseSellerBillingStatus(Array.isArray(data) ? data[0] : null);
    setStatus(row);
    setError(!row);
    setIsLoading(false);
    return row;
  }, []);

  useEffect(() => {
    let active = true;
    void supabase.rpc("seller_get_saas_billing_status").then(({ data, error: requestError }) => {
      if (!active) return;
      const row = requestError
        ? null
        : parseSellerBillingStatus(Array.isArray(data) ? data[0] : null);
      setStatus(row);
      setError(!row);
      setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(
    () => ({ error, isLoading, reload, status }),
    [error, isLoading, reload, status],
  );

  return <SellerBillingContext.Provider value={value}>{children}</SellerBillingContext.Provider>;
}

export function useSellerBillingStatus() {
  const context = useContext(SellerBillingContext);
  if (!context) throw new Error("Seller billing context is unavailable.");
  return context;
}
