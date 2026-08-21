import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { AdminWebinarForm } from "../../../_components/admin-webinar-form";
export default async function Page({ params }: { params: Promise<{ webinarId: string }> }) { const { webinarId } = await params; const { data, error } = await supabase.from("webinars").select("*").eq("id", webinarId).single(); if (error || !data) notFound(); return <AdminWebinarForm webinar={data} />; }
