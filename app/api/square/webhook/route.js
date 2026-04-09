import { NextResponse } from "next/server";
import { WebhooksHelper } from "square";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s/-]/g, "");
}

async function getSquareOrder(orderId) {
  const response = await fetch(`https://connect.squareup.com/v2/orders/${orderId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      "Square-Version": "2026-01-22",
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Square order fetch failed: ${response.status} ${text}`);
  }

  const json = await response.json();
  return json.order;
}

async function alreadyProcessed(squarePaymentId) {
  const { data, error } = await supabaseAdmin
    .from("square_processed_payments")
    .select("id")
    .eq("square_payment_id", squarePaymentId)
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

async function markProcessed(squarePaymentId, squareOrderId, payload) {
  const { error } = await supabaseAdmin
    .from("square_processed_payments")
    .insert({
      square_payment_id: squarePaymentId,
      square_order_id: squareOrderId || null,
      payload,
    });

  if (error) throw error;
}

async function loadServices() {
  const { data, error } = await supabaseAdmin
    .from("service_inventory")
    .select("id, service_key, service_name, square_catalog_object_id, remaining_slots")
    .eq("is_active", true);

  if (error) throw error;
  return data || [];
}

async function decrementService(serviceId, quantity) {
  const { data: current, error: readError } = await supabaseAdmin
    .from("service_inventory")
    .select("remaining_slots")
    .eq("id", serviceId)
    .single();

  if (readError) throw readError;

  const nextRemaining = Math.max(0, (current?.remaining_slots || 0) - quantity);

  const { error: updateError } = await supabaseAdmin
    .from("service_inventory")
    .update({ remaining_slots: nextRemaining })
    .eq("id", serviceId);

  if (updateError) throw updateError;
}

function findMatchingService(lineItem, services) {
  const catalogObjectId = lineItem?.catalog_object_id || null;
  const lineName = normalizeText(lineItem?.name || "");

  if (catalogObjectId) {
    const byCatalogId = services.find(
      (service) => service.square_catalog_object_id && service.square_catalog_object_id === catalogObjectId
    );
    if (byCatalogId) return byCatalogId;
  }

  if (lineName) {
    const byName = services.find(
      (service) => normalizeText(service.service_name) === lineName
    );
    if (byName) return byName;
  }

  return null;
}

export async function POST(request) {
  try {
    const rawBody = await request.text();
    const signatureHeader = request.headers.get("x-square-hmacsha256-signature") || "";

    const isValid = await WebhooksHelper.verifySignature({
      requestBody: rawBody,
      signatureHeader,
      signatureKey: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY,
      notificationUrl: process.env.SQUARE_WEBHOOK_NOTIFICATION_URL,
    });

    if (!isValid) {
      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 403 });
    }

    const payload = JSON.parse(rawBody);
    const eventType = payload?.type || "";
    const payment = payload?.data?.object?.payment;

    if (eventType !== "payment.updated") {
      return NextResponse.json({ ok: true, skipped: true, reason: "Unhandled event type" });
    }

    if (!payment || payment.status !== "COMPLETED") {
      return NextResponse.json({ ok: true, skipped: true, reason: "Payment not completed" });
    }

    const squarePaymentId = payment.id;
    const squareOrderId = payment.order_id;

    if (!squarePaymentId) {
      return NextResponse.json({ ok: true, skipped: true, reason: "Missing payment id" });
    }

    if (await alreadyProcessed(squarePaymentId)) {
      return NextResponse.json({ ok: true, skipped: true, reason: "Already processed" });
    }

    if (!squareOrderId) {
      await markProcessed(squarePaymentId, null, payload);
      return NextResponse.json({ ok: true, skipped: true, reason: "No order_id on payment" });
    }

    const order = await getSquareOrder(squareOrderId);
    const lineItems = order?.line_items || [];

    if (!lineItems.length) {
      await markProcessed(squarePaymentId, squareOrderId, payload);
      return NextResponse.json({ ok: true, skipped: true, reason: "No line items on order" });
    }

    const services = await loadServices();

    for (const lineItem of lineItems) {
      const matchedService = findMatchingService(lineItem, services);
      if (!matchedService) continue;

      const quantity = Math.max(1, parseInt(lineItem.quantity || "1", 10) || 1);
      await decrementService(matchedService.id, quantity);
    }

    await markProcessed(squarePaymentId, squareOrderId, payload);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Square webhook error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Webhook failed" },
      { status: 500 }
    );
  }
}