"use client";

import { supabase } from "@/lib/supabase";

export async function isCurrentUserPlatformAdmin() {
  const { data, error } = await supabase.rpc("is_platform_admin");

  if (error) {
    return false;
  }

  return data === true;
}
