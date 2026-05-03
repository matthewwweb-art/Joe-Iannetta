import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch("https://connect.squareup.com/v2/merchants", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        "Square-Version": "2026-01-22",
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    const data = await response.json();

    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      merchants: data?.merchant
        ? [data.merchant]
        : data?.merchants || data,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message || "Square debug failed" },
      { status: 500 }
    );
  }
}