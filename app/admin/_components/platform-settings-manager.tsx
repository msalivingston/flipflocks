"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  AdminAccessState,
  AdminCard,
  AdminErrorState,
  AdminLoadingState,
  AdminStatusBadge,
  isAdminAuthorizationError,
} from "./admin-ui";

type LoadState = "loading" | "ready" | "access" | "error";

export function PlatformSettingsManager() {
  const [enabled, setEnabled] = useState(true);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadSetting() {
      setLoadState("loading");

      const { data, error } = await supabase.rpc(
        "public_seller_signups_enabled",
      );

      if (!isMounted) return;

      if (error) {
        setLoadState(
          isAdminAuthorizationError(error.message) ? "access" : "error",
        );
        return;
      }

      setEnabled(data !== false);
      setLoadState("ready");
    }

    void loadSetting();

    return () => {
      isMounted = false;
    };
  }, []);

  async function updateSignupSetting(nextEnabled: boolean) {
    const previousEnabled = enabled;

    setEnabled(nextEnabled);
    setMessage(null);
    setIsSaving(true);

    const { data, error } = await supabase.rpc(
      "admin_set_seller_signups_enabled",
      {
        p_enabled: nextEnabled,
      },
    );

    if (error) {
      setEnabled(previousEnabled);
      setMessage("Could not save this setting. Please try again.");
      setIsSaving(false);
      return;
    }

    setEnabled(data !== false);
    setMessage(
      `Saved. New seller signups are ${data === false ? "off" : "on"}.`,
    );
    setIsSaving(false);
  }

  if (loadState === "loading") {
    return <AdminLoadingState label="Loading platform settings..." />;
  }

  if (loadState === "access") {
    return (
      <AdminAccessState message="Sign in with a platform admin account to manage platform settings." />
    );
  }

  if (loadState === "error") {
    return (
      <AdminErrorState message="Platform settings could not be loaded right now." />
    );
  }

  return (
    <AdminCard>
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-bold text-stone-950">
              New seller signups
            </h2>
            <AdminStatusBadge value={enabled ? "On" : "Off"} />
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
            Controls whether visitors can start creating a new FlockFront
            seller account from the public website.
          </p>
          {message ? (
            <p
              className={`mt-3 text-sm font-semibold ${
                message.startsWith("Saved")
                  ? "text-emerald-700"
                  : "text-red-700"
              }`}
              role="status"
            >
              {message}
            </p>
          ) : null}
        </div>

        <label
          className={`inline-flex w-fit items-center gap-3 ${
            isSaving ? "cursor-not-allowed opacity-75" : "cursor-pointer"
          }`}
        >
          <span className="text-sm font-bold text-stone-700">
            {enabled ? "On" : "Off"}
          </span>
          <input
            checked={enabled}
            className="peer sr-only"
            disabled={isSaving}
            onChange={(event) => updateSignupSetting(event.target.checked)}
            type="checkbox"
          />
          <span
            className={`relative h-8 w-14 rounded-full transition ${
              enabled ? "bg-[#145447]" : "bg-stone-300"
            }`}
          >
            <span
              className={`absolute left-1 top-1 size-6 rounded-full bg-white shadow-sm transition ${
                enabled ? "translate-x-6" : ""
              }`}
            />
          </span>
        </label>
      </div>
    </AdminCard>
  );
}
