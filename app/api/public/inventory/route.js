import { NextResponse } from "next/server";
import { getPool } from "../../../../lib/neonDb";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET() {
  try {
    const pool = getPool();

    const result = await pool.query(`
      select
        service_key,
        service_name,
        total_slots,
        remaining_slots,
        is_active,
        updated_at
      from service_inventory
      where is_active = true
      order by service_name asc
    `);

    const services = (result.rows || []).map((item) => ({
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
        headers: CORS_HEADERS,
      }
    );
  } catch (error) {
    console.error("Public inventory error:", error);

    return NextResponse.json(
      { ok: false, error: error.message || "Failed to load inventory" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}