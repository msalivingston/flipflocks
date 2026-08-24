"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { AdminWebinarRow } from "../../../_lib/admin-types";
import { AdminWebinarForm } from "../../../_components/admin-webinar-form";
import { AdminErrorState, AdminLoadingState } from "../../../_components/admin-ui";

export default function Page() {
  const { webinarId } = useParams<{ webinarId: string }>();
  const [webinar, setWebinar] = useState<AdminWebinarRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const result = await supabase.from("webinars").select("*").eq("id", webinarId).single();
      if (result.error) setError(result.error.message);
      else setWebinar(result.data as AdminWebinarRow);
      setLoading(false);
    })();
  }, [webinarId]);

  if (loading) return <div className="p-5"><AdminLoadingState label="Loading webinar" /></div>;
  if (error || !webinar) return <div className="p-5"><AdminErrorState message={error ?? "Webinar not found."} /></div>;

  return <AdminWebinarForm webinar={webinar} />;
}
