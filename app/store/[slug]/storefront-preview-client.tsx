"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  EmptyStorefront,
  StorefrontShell,
} from "./storefront-ui";
import type {
  StorefrontEquipmentItem,
  StorefrontHatchingEggItem,
  StorefrontHome,
  StorefrontInventoryItem,
  StorefrontProcessedPoultryItem,
  StorefrontProfileImageMap,
} from "./storefront-data";
import { StorefrontHomeContent } from "./storefront-home-content";

type PreviewHome = StorefrontHome & {
  preview_is_hidden: boolean;
};

type PreviewData = {
  equipment: StorefrontEquipmentItem[];
  hatching_eggs: StorefrontHatchingEggItem[];
  inventory: StorefrontInventoryItem[];
  live_poultry_profile_images: StorefrontProfileImageMap;
  processed_poultry: StorefrontProcessedPoultryItem[];
  storefront_home: PreviewHome;
};

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      equipment: StorefrontEquipmentItem[];
      hatchingEggs: StorefrontHatchingEggItem[];
      inventory: StorefrontInventoryItem[];
      livePoultryProfileImages: StorefrontProfileImageMap;
      processedPoultry: StorefrontProcessedPoultryItem[];
      status: "ready";
      store: PreviewHome;
    };

export function StorefrontPreviewClient({
  returnTo,
  slug,
}: {
  returnTo: string;
  slug: string;
}) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    let isMounted = true;

    async function loadPreview() {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError || !sessionData.session) {
        if (isMounted) {
          setState({
            status: "error",
            message: "Sign in as this seller to preview the hidden storefront.",
          });
        }
        return;
      }

      const [homeResult, previewResult] = await Promise.all([
        supabase
          .rpc("get_seller_storefront_home_preview", {
            p_store_slug: slug,
          })
          .maybeSingle(),
        supabase
          .rpc("get_seller_storefront_preview_data", {
            p_store_slug: slug,
          })
          .maybeSingle(),
      ]);

      if (!isMounted) return;

      if (homeResult.error || !homeResult.data) {
        setState({
          status: "error",
          message: "This storefront preview is not available for your account.",
        });
        return;
      }

      if (previewResult.error || !previewResult.data) {
        setState({
          status: "error",
          message: "This storefront's preview inventory is not available.",
        });
        return;
      }

      const previewData = previewResult.data as unknown as PreviewData;
      const authorizedHome = homeResult.data as PreviewHome;

      setState({
        equipment: previewData.equipment,
        hatchingEggs: previewData.hatching_eggs,
        inventory: previewData.inventory,
        livePoultryProfileImages: previewData.live_poultry_profile_images,
        processedPoultry: previewData.processed_poultry,
        status: "ready",
        store: withPreviewInventoryCounts(
          authorizedHome,
          previewData.storefront_home,
        ),
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
        hatchingEggs={state.hatchingEggs}
        inventory={state.inventory}
        livePoultryProfileImages={state.livePoultryProfileImages}
        processedPoultry={state.processedPoultry}
        previewExitHref={returnTo}
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

function withPreviewInventoryCounts(
  authorizedHome: PreviewHome,
  inventoryHome: PreviewHome,
): PreviewHome {
  return {
    ...authorizedHome,
    has_public_inventory: inventoryHome.has_public_inventory,
    next_available_date: inventoryHome.next_available_date,
    public_inventory_item_count: inventoryHome.public_inventory_item_count,
    ready_now_item_count: inventoryHome.ready_now_item_count,
    reserve_now_item_count: inventoryHome.reserve_now_item_count,
    sold_out_item_count: inventoryHome.sold_out_item_count,
    total_quantity_available: inventoryHome.total_quantity_available,
  };
}
