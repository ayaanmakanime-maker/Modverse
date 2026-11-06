/**
 * A minimal simulated Shiprocket API for tests (shapes follow the public API docs).
 * Records every request so tests can assert what would be sent to the real service.
 */
export interface SimRequest { method: string; path: string; body: unknown; auth: string | null }

export function shiprocketSim(opts: { awb?: string; track?: { current: string; activities: { date: string; activity: string; location: string; "sr-status-label": string }[] }; failLogin?: boolean; noAwb?: boolean } = {}) {
  const requests: SimRequest[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace("/v1/external", "") + url.search;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
    requests.push({ method: init?.method ?? "GET", path, body, auth });
    if (url.hostname !== "apiv2.shiprocket.in") return json(404, { message: "unexpected host" });
    if (path === "/auth/login") return opts.failLogin ? json(400, { message: "Invalid email and password combination" }) : json(200, { token: "sim-token-123" });
    if (auth !== "Bearer sim-token-123") return json(401, { message: "Unauthenticated" });
    if (path.startsWith("/courier/serviceability/")) return json(200, { data: { available_courier_companies: [
      { courier_company_id: 10, courier_name: "Delhivery Surface", rate: "89.5", estimated_delivery_days: "4", etd: "Nov 11, 2026", cod: 1, rating: "4.1" },
      { courier_company_id: 24, courier_name: "Xpressbees Surface", rate: 76, estimated_delivery_days: 5, etd: "Nov 12, 2026", cod: 1, rating: 3.9 },
      { courier_company_id: 1, courier_name: "Blue Dart Air", rate: 162, estimated_delivery_days: 2, etd: "Nov 9, 2026", cod: 0, rating: 4.6 },
    ] } });
    if (path === "/orders/create/adhoc") return json(200, { order_id: 9001, shipment_id: 7001, status: "NEW" });
    if (path === "/courier/assign/awb") return json(200, opts.noAwb ? { awb_assign_status: 0, response: { data: {} } } : { awb_assign_status: 1, response: { data: { awb_code: opts.awb ?? "SIM1234567890", courier_name: "Xpressbees Surface" } } });
    if (path === "/courier/generate/pickup") return json(200, { pickup_status: 1, response: { pickup_scheduled_date: "2026-11-07 11:00:00" } });
    if (path === "/courier/generate/label") return json(200, { label_created: 1, label_url: "https://example.invalid/label/7001.pdf" });
    if (path.startsWith("/courier/track/awb/")) return json(200, { tracking_data: { shipment_track: [{ current_status: opts.track?.current ?? "IN TRANSIT" }], shipment_track_activities: opts.track?.activities ?? [] } });
    return json(404, { message: `no route ${path}` });
  }) as typeof fetch;
  return { fetchImpl, requests };
}
