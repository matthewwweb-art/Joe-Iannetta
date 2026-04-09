import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function isAuthorized(request) {
  const headerSecret = request.headers.get("x-inventory-admin-secret");
  return headerSecret && headerSecret === process.env.INVENTORY_ADMIN_SECRET;
}

export async function POST(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);

  if (!body || !body.action) {
    return NextResponse.json(
      { ok: false, error: "Missing action" },
      { status: 400 }
    );
  }

  if (body.action === "reset_all") {
    const { data: rows, error: readError } = await supabaseAdmin
      .from("service_inventory")
      .select("id, total_slots");

    if (readError) {
      return NextResponse.json({ ok: false, error: readError.message }, { status: 500 });
    }

    for (const row of rows || []) {
      const { error: updateError } = await supabaseAdmin
        .from("service_inventory")
        .update({ remaining_slots: row.total_slots })
        .eq("id", row.id);

      if (updateError) {
        return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, message: "All services reset" });
  }

  if (body.action === "set_one") {
    const { service_key, remaining_slots } = body;

    if (!service_key || typeof remaining_slots !== "number") {
      return NextResponse.json(
        { ok: false, error: "service_key and numeric remaining_slots are required" },
        { status: 400 }
      );
    }

    const safeRemaining = Math.max(0, Math.floor(remaining_slots));

    const { error } = await supabaseAdmin
      .from("service_inventory")
      .update({ remaining_slots: safeRemaining })
      .eq("service_key", service_key);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: "Service updated" });
  }

  return NextResponse.json(
    { ok: false, error: "Unknown action" },
    { status: 400 }
  );
}