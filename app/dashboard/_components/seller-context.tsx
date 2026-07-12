"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { isCurrentUserPlatformAdmin } from "@/app/admin/_lib/admin-auth";
import type { SellerContext } from "../_lib/seller-types";

type SellerBootstrapState = {
  seller: SellerContext | null;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
};

const SellerContextState = createContext<SellerBootstrapState | null>(null);

export function SellerContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [seller, setSeller] = useState<SellerContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadKey, setLoadKey] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function bootstrapSeller() {
      setIsLoading(true);
      setError(null);

      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (!isMounted) return;

      if (userError) {
        setError(userError.message);
        setIsLoading(false);
        return;
      }

      if (!userData.user) {
        router.replace("/login");
        return;
      }

      const { data, error: contextError } =
        await supabase.rpc("get_seller_context");

      if (!isMounted) return;

      if (contextError) {
        setError(contextError.message);
        setIsLoading(false);
        return;
      }

      const sellerRows = Array.isArray(data) ? (data as SellerContext[]) : [];
      const primarySeller = sellerRows[0] ?? null;

      if (!primarySeller) {
        const isPlatformAdmin = await isCurrentUserPlatformAdmin();
        if (!isMounted) return;

        router.replace(isPlatformAdmin ? "/admin" : "/onboarding");
        return;
      }

      setSeller(primarySeller);
      setIsLoading(false);
    }

    void bootstrapSeller();

    return () => {
      isMounted = false;
    };
  }, [loadKey, router]);

  const value = useMemo(
    () => ({
      seller,
      isLoading,
      error,
      reload: () => setLoadKey((current) => current + 1),
    }),
    [seller, isLoading, error],
  );

  return (
    <SellerContextState.Provider value={value}>
      {children}
    </SellerContextState.Provider>
  );
}

export function useSellerContext() {
  const value = useContext(SellerContextState);

  if (!value) {
    throw new Error("useSellerContext must be used inside SellerContextProvider");
  }

  return value;
}
