import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("service_inventory")
    .select("service_key, service_name, total_slots, remaining_slots, is_active, updated_at")
    .eq("is_active", true)
    .order("service_name", { ascending: true });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  const services = (data || []).map((item) => ({
    service_key: item.service_key,
    service_name: item.service_name,
    total_slots: item.total_slots,
    remaining_slots: item.remaining_slots,
    percent_remaining:
      item.total_slots > 0
        ? Math.round((item.remaining_slots / item.total_slots) * 100)
        : 0,
    updated_at: item.updated_at,
  }));

  return NextResponse.json(
    {
      ok: true,
      services,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    }
  );
}