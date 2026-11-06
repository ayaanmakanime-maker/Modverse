import { z } from "zod";
import { route } from "@/lib/api/handler";
import { bookWithShiprocket, courierQuotes } from "@/lib/services/courier";

/** Courier quotes (free, read-only). */
export const GET = route<{ id: string }>({ auth: "staff" }, async ({ params }) => courierQuotes(params.id));

/** BILLABLE courier booking on ModVerse's Shiprocket account — admin only, explicit confirmation required. */
export const POST = route<{ id: string }>({ auth: "admin", rate: { name: "courier-book", limit: 20, windowMs: 60 * 60_000, by: "user" } }, async ({ user, params, body }) => ({ shipment: await bookWithShiprocket(user, params.id, await body(z.unknown())) }));
