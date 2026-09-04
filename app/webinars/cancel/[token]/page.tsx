import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { publicSupabase } from "@/lib/public-supabase";
import { CancelRegistrationForm } from "./cancel-registration-form";

type WebinarCancellation = {
  webinar_title: string;
  starts_at: string;
  timezone: string;
  cancellation_status: "active" | "canceled";
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const metadata: Metadata = {
  title: "Cancel webinar registration | FlockFront",
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!uuidPattern.test(token)) notFound();

  const { data, error } = await publicSupabase
    .rpc("get_public_webinar_cancellation", { p_token: token })
    .maybeSingle();
  const cancellation = data as WebinarCancellation | null;
  if (error || !cancellation) notFound();

  const webinarDate = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: cancellation.timezone,
  }).format(new Date(cancellation.starts_at));

  return (
    <main className="min-h-screen bg-[#fffaf1] px-5 py-8 text-[#10281c]">
      <div className="mx-auto max-w-xl">
        <Link href="/">
          <Image
            alt="FlockFront"
            className="mx-auto h-auto w-44"
            height={236}
            src="/branding/flockfront-logo-final-cropped.png"
            width={1549}
          />
        </Link>
        <section className="mt-8 rounded-2xl bg-white p-6 shadow-[0_8px_24px_rgba(45,35,20,0.09)] ring-1 ring-stone-200 sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#17613a]">
            Webinar registration
          </p>
          <h1 className="mt-2 font-serif text-2xl font-bold">{cancellation.webinar_title}</h1>
          <p className="mb-6 mt-2 text-sm font-semibold text-[#59635d]">{webinarDate}</p>
          <CancelRegistrationForm
            alreadyCanceled={cancellation.cancellation_status === "canceled"}
            token={token}
          />
        </section>
      </div>
    </main>
  );
}
