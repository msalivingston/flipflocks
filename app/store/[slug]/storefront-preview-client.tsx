"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  EmptyStorefront,
  StorefrontShell,
} from "./storefront-ui";
import {
  StorefrontHome,
  loadStorefrontEquipment,
  loadStorefrontInventory,
  loadStorefrontProcessedPoultry,
} from "./storefront-data";
import { StorefrontHomeContent } from "./storefront-home-content";

type PreviewHome = StorefrontHome & {
  preview_is_hidden: boolean;
};

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      equipment: Awaited<ReturnType<typeof loadStorefrontEquipment>>["data"];
      inventory: Awaited<ReturnType<typeof loadStorefrontInventory>>["data"];
      processedPoultry: Awaited<
        ReturnType<typeof loadStorefrontProcessedPoultry>
      >["data"];
      status: "ready";
      store: PreviewHome;
    };

export function StorefrontPreviewClient({ slug }: { slug: string }) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    let isMounted = true;

    async function loadPreview() {
      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (userError || !userData.user) {
        if (isMounted) {
          setState({
            status: "error",
            message: "Sign in as this seller to preview the hidden storefront.",
          });
        }
        return;
      }

      const [
        homeResult,
        inventoryResult,
        equipmentResult,
        processedPoultryResult,
      ] = await Promise.all([
        supabase
          .rpc("get_seller_storefront_home_preview", {
            p_store_slug: slug,
          })
          .maybeSingle(),
        loadStorefrontInventory(slug),
        loadStorefrontEquipment(slug),
        loadStorefrontProcessedPoultry(slug),
      ]);
      const error =
        homeResult.error ??
        inventoryResult.error ??
        equipmentResult.error ??
        processedPoultryResult.error;

      if (!isMounted) return;

      if (error || !homeResult.data) {
        setState({
          status: "error",
          message: "This storefront preview is not available for your account.",
        });
        return;
      }

      setState({
        equipment: equipmentResult.data,
        inventory: inventoryResult.data,
        processedPoultry: processedPoultryResult.data,
        status: "ready",
        store: homeResult.data as PreviewHome,
      });
    }

    void loadPreview();

    return () => {
      isMounted = false;
    };
  }, [slug]);

  if (state.status === "ready") {
    return (
      <StorefrontHomeContent
        equipment={state.equipment}
        inventory={state.inventory}
        processedPoultry={state.processedPoultry}
        showPreviewBanner={state.store.preview_is_hidden}
        store={state.store}
      />
    );
  }

  return (
    <StorefrontShell>
      <main className="mx-auto max-w-3xl px-5 py-12 sm:px-7">
        <EmptyStorefront
          title={
            state.status === "loading"
              ? "Loading storefront preview"
              : "Storefront preview unavailable"
          }
          description={
            state.status === "loading"
              ? "Checking your seller access."
              : state.message
          }
        />
      </main>
    </StorefrontShell>
  );
}
