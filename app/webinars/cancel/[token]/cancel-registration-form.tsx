"use client";

import { useState } from "react";
import { publicSupabase } from "@/lib/public-supabase";

type CancellationState = "ready" | "submitting" | "canceled" | "already_canceled";

export function CancelRegistrationForm({
  token,
  alreadyCanceled,
}: {
  token: string;
  alreadyCanceled: boolean;
}) {
  const [state, setState] = useState<CancellationState>(
    alreadyCanceled ? "already_canceled" : "ready",
  );
  const [error, setError] = useState<string | null>(null);

  async function cancelRegistration() {
    setError(null);
    setState("submitting");
    const { data, error: invokeError } = await publicSupabase.functions.invoke(
      "webinar-registration-cancel",
      { body: { token } },
    );

    if (invokeError) {
      setError("We couldn’t cancel your registration. Please try again or contact hello@flockfront.com.");
      setState("ready");
      return;
    }

    setState(data?.status === "already_canceled" ? "already_canceled" : "canceled");
  }

  if (state === "canceled") {
    return (
      <div className="rounded-xl bg-[#edf7ed] p-6 text-center" role="status">
        <h2 className="text-xl font-bold text-[#155c32]">Your registration has been canceled</h2>
        <p className="mt-2 text-sm leading-6 text-[#3f5145]">
          You will not receive the webinar reminder.
        </p>
      </div>
    );
  }

  if (state === "already_canceled") {
    return (
      <div className="rounded-xl bg-[#f3f1ec] p-6 text-center" role="status">
        <h2 className="text-xl font-bold text-[#10281c]">This registration is already canceled</h2>
        <p className="mt-2 text-sm leading-6 text-[#59635d]">
          No further action is needed.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm leading-6 text-[#59635d]">
        Are you sure you want to cancel your registration? You will no longer receive the webinar reminder.
      </p>
      <button
        className="mt-5 min-h-12 w-full rounded-md bg-[#9f2d20] px-4 text-base font-bold text-white transition hover:bg-[#812419] disabled:opacity-60"
        disabled={state === "submitting"}
        onClick={() => void cancelRegistration()}
        type="button"
      >
        {state === "submitting" ? "Canceling…" : "Cancel registration"}
      </button>
      <p aria-live="polite" className="mt-3 text-sm text-red-700">{error}</p>
    </div>
  );
}
