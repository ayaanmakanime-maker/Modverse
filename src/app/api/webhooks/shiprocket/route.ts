import { NextResponse, type NextRequest } from "next/server";
import { handleShiprocketWebhook } from "@/lib/services/courier";

/** Shiprocket tracking webhook — authenticated with the shared token Shiprocket sends as `x-api-key`. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 200_000) return NextResponse.json({ error: "too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const r = await handleShiprocketWebhook(req.headers.get("x-api-key"), body);
  return NextResponse.json(r.body, { status: r.status });
}
