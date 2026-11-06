# Manufacturer & logistics portals (V2)

Status: **Locally implemented** — every workflow below runs end-to-end in the local app and is covered by tests. Partner-issued AWBs/labels are **Simulated** (ModVerse-issued); ModVerse can alternatively book couriers on its own **Shiprocket** account (**Awaiting credentials**, see "Courier aggregator").

Code: `src/lib/services/partners.ts` (all rules and access checks) · `src/lib/partners/constants.ts` (shared states) · `src/components/partners/*` (portal UI) · `src/components/admin/AdminPartners.tsx` (admin UI) · migrations `drizzle/0004_v2_partner_portals.sql`, `0005_v21_settlements.sql`, `0006_v21_courier_ref.sql` (additive only) · `src/lib/services/{partner-access,settlements,notify,courier}.ts` · `src/lib/integrations/shiprocket.ts`.

## Who sees what
| | Customer | Manufacturer member | Logistics member | Staff | Admin |
|---|---|---|---|---|---|
| Own orders, production stage, tracking, own disputes | ✓ | — | — | ✓ | ✓ |
| Jobs assigned to **their organisation**: design snapshot, spec, placements, quantity, production tech pack | — | ✓ | — | ✓ | ✓ |
| Customer artwork used by an **active** job of their organisation | — | ✓ | — | ✓ | ✓ |
| Shipments assigned to **their organisation**: delivery address, phone, units, weight, COD amount | — | — | ✓ | ✓ | ✓ |
| Retail prices, customer email, other organisations' work | — | ✗ | ✗ | ✓ | ✓ |
| Approve partners, approve quotations | — | — | — | — | ✓ |
| Assign/reassign, create shipments, rework, disputes | — | — | — | ✓ | ✓ |

**Organisation isolation** — every partner call resolves the caller's *approved* organisation (`requirePartner`) and filters by its id. Another organisation's job or shipment returns **404** (indistinguishable from "doesn't exist"); the wrong partner type returns **403**; pending/suspended/rejected organisations are refused immediately (`partner_pending` / `partner_inactive`). File access (`partnerCanReadUpload`) is granted only for production photos and POD photos on the organisation's own records, and for customer artwork referenced by an order whose job for that organisation is still active — a cancelled or reassigned job loses access at once. Manufacturer job views and the production tech pack PDF omit retail prices and customer contact details; logistics views omit designs and prices. Partner names never appear on the customer's timeline (assignment notes and partner disputes are staff-only events). `tests/integration/partners.test.ts` asserts each of these.

## Onboarding
1. A signed-in user applies at **/partners** as a manufacturer or logistics company: business details, optional GSTIN (format-validated), and capabilities —
   * manufacturer: decoration methods, garment types, audiences, knit/woven, minimum order, daily capacity, lead time, certifications (self-declared);
   * logistics: couriers booked, service states, COD, express, maximum parcel weight.
2. The application is **pending** until an admin approves it at **Admin → Partners** (approve / reject / suspend / reinstate — all audited).
3. The owner can edit capabilities and add teammates (existing ModVerse accounts) at **/partner/organisation**. A user belongs to at most one organisation.

## Manufacturing workflow
```
paid order ─ staff approves every item ─ staff assigns manufacturer (capability check; mismatch needs explicit override)
  offered ──accept──▶ accepted ──quote──▶ quoted ──admin approves──▶ quote_approved ──stage──▶ in_production
     │                    ▲                 │ admin rejects → accepted (re-quote)                │
     └─decline (reason)   └─────────────────┘                                    QC fail → rework ─┤
                                                                                  QC pass → qc_passed ─ready──▶ ready_to_dispatch ─pickup──▶ dispatched
```
* Reassigning cancels the previous active job (its access ends) and creates a new offer.
* Stages: cutting, printing, embroidery, sewing, finishing, pressing, packing.
* Issues (low/medium/high) can be reported and resolved at any time; open issues and overdue jobs are flagged on **Admin → Production**.
* QC reports carry a checklist, sample size and defects; a "pass" with a failed check is rejected. A fail moves the job to rework; staff can also request rework.
* Production photos are stored as private uploads.
* Order status advances automatically and **only forward**: quote approved → `manufacturing`, QC pass → `quality_inspection`, ready → `packed`, pickup → `shipped`, delivery → `delivered` (`progressOrder` in `commerce.ts`).
* **Production tech pack**: `/api/partner/jobs/:id/techpack?item=` renders the tech pack from the immutable order snapshot, marked PRODUCTION COPY with order number, quantity and size, without retail prices.

## Logistics workflow
```
staff creates shipment (approved partner, courier from its list, COD only if supported)
assigned ─label─▶ label_created ─▶ pickup_scheduled ─▶ picked_up ─▶ in_transit ─▶ out_for_delivery ─▶ delivered (POD required)
                                                                                     └─▶ failed_delivery (reason) ─▶ out_for_delivery | rto_initiated ─▶ returned
```
* Labels: 4×6 in PDF with AWB, addresses, units, weight, COD amount (`src/lib/shipping-label-pdf.ts`). The stripe pattern is visual only — **not a carrier-certified barcode**.
* Pickup scheduling stores a date and window. Every update is appended to the shipment's event log (location, note, reason) and to the order timeline.
* Proof of delivery: receiver name and/or POD photo; delivery is refused without one.
* Return shipments (for shipped/delivered orders) run customer → returns facility and never move the order backwards.
* Staff can reassign a shipment to another partner/courier until pickup (the AWB is re-issued).

## Disputes
Customers (order page → "Report a problem") and partners involved in the order (job or shipment page) can raise disputes: quality, delay, damage, delivery, payment, other. Anyone else gets 404. Staff manage them at **Admin → Disputes** (investigate / resolve / reject with a written resolution). Customers see the resolution of their own disputes.

## Admin pages
**Partners** (approval) · **Production** (board: status, stage, due/overdue, open issues, last QC, pending quotation approve/reject, rework) · **Shipping** (open/exceptions, reassign) · **Disputes** · **Order detail → Manufacturing & logistics partners** (assign/reassign with capability match, quotations, job events & photos, create forward/return shipments, shipment events).

## API
Partner (`auth: user`, organisation-scoped): `GET/PATCH /api/partner/me`, `POST /api/partner/apply`, `GET/POST /api/partner/members`, `GET /api/partner/jobs`, `GET/POST /api/partner/jobs/:id` (`accept|reject|quote|stage|issue|resolve_issue|qc|ready`), `POST /api/partner/jobs/:id/photos`, `GET /api/partner/jobs/:id/techpack`, `GET /api/partner/shipments`, `GET/POST /api/partner/shipments/:id` (`label|track`), `GET /api/partner/shipments/:id/label`, `POST /api/partner/shipments/:id/pod`, `GET/POST /api/disputes`.
Admin: `GET /api/admin/partners`, `PATCH /api/admin/partners/:id` (admin), `GET /api/admin/production`, `POST /api/admin/production/:id`, `POST /api/admin/quotations/:id` (admin), `GET/POST /api/admin/orders/:id/fulfilment`, `GET /api/admin/shipments`, `PATCH /api/admin/shipments/:id`, `GET /api/admin/disputes`, `PATCH /api/admin/disputes/:id`.
All writes are rate-limited, CSRF-protected by the origin middleware, validated with Zod and audited.

## Notifications (V2.1)
Every step notifies the people who must act, through the email layer (`src/lib/services/notify.ts`): the **simulated mailbox** (Account → Mailbox, linked as *Messages* in the portal) by default, Resend once enabled. Partner organisations: application received/approved/suspended, new offer, quotation approved/rejected, rework requested, new or reassigned shipment, payout due/paid/adjusted. ModVerse admins: new applications and quotations to approve. Operations (staff + admins): declined jobs, production issues, QC failures, orders ready for pickup, failed deliveries, new disputes. Customers: shipped (with tracking number), out for delivery, delivery failed, delivered (with a prompt to verify fit), dispute resolved. Notifications never block the action that triggered them. SMS (MSG91) is not connected.

## Payouts — settlements ledger (V2.1)
* **Production:** when a job is dispatched (courier pickup), a payable for the **approved quotation** is created for the manufacturer.
* **Shipping:** when a shipment is delivered or returned, a payable for the **agreed rate** entered when ModVerse booked it is created for the logistics partner (no rate → nothing accrues).
* Admin → **Payouts**: per-partner totals, adjust (with a reason shared with the partner), cancel, or **record a payment made outside ModVerse** with its bank/UPI reference; CSV export for accounting (spreadsheet formulas neutralised). Partner → **Payouts** shows only its own organisation's entries. Unique per job/shipment (idempotent), audited. **No money is moved by ModVerse** — status: **Locally implemented** (ledger); bank payouts: **Not implemented**.

## GSTIN checks (V2.1)
Applications validate the GSTIN format, state code and **mod-36 check character** (`src/lib/partners/gstin.ts`), with specific messages. This proves a number is well-formed, not that it is registered: an online GST lookup needs a GSP/API account (**Not implemented**) — admins verify before approving.

## Courier aggregator — Shiprocket (V2.1, Awaiting credentials)
An alternative to a logistics partner: ModVerse books on its **own** Shiprocket account (`src/lib/integrations/shiprocket.ts`, `src/lib/services/courier.ts`).
* **Quotes** (free): couriers, prices, delivery estimate for the parcel (≈250 g per garment + 100 g packaging) to the customer's PIN code.
* **Booking** (admin only, **billable**): an explicit "this books a real pickup billed to the Shiprocket wallet" confirmation is required every time (Shiprocket has no sandbox). Creates the order, assigns the AWB, requests the pickup and the label; the shipment stores the AWB, label link and courier tracking link.
* **Tracking**: "Sync tracking" pulls scans; the webhook `POST /api/webhooks/shiprocket` (authenticated with the token Shiprocket sends as `x-api-key`, compared in constant time) applies status pushes. Courier feeds may skip scans, so any forward move is accepted, exceptions (undelivered, RTO) are mapped, and stale or backward scans are ignored. Order progression, notifications and audit are shared with the partner workflow.
* Written against the public API docs and tested against a **simulated** Shiprocket API (`tests/stubs/shiprocket-sim.ts`); it has **not** been run against a live account. Verify with a real account before relying on it.

## Not yet connected
| Capability | Status |
|---|---|
| Shiprocket live account | **Awaiting credentials** (adapter, booking, sync and webhook implemented; tested against a simulated API) |
| Courier APIs used by logistics partners themselves | **Not implemented** — partners post tracking in the portal (ModVerse-issued AWB/label = **Simulated**) |
| Bank payouts / invoices | **Not implemented** — the settlements ledger records payments made outside ModVerse |
| SMS / WhatsApp notifications | **Not implemented** (email + simulated mailbox only) |
| Online GSTIN lookup / KYC | **Not implemented** — format + check character only; admins verify manually |
