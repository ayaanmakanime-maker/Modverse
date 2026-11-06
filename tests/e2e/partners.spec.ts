import { expect, test, type Page } from "@playwright/test";
import { ADMIN, login, logout, openEditor, register, saveDesign, uniqueEmail } from "./helpers";

const ORIGIN = { Origin: "http://localhost:3100" };

async function placePaidOrder(page: Page) {
  await openEditor(page, "tee-classic-crew", "men", "studio");
  await page.getByTestId("tab-text").click();
  await page.locator("#new-text").fill("LOOM");
  await page.getByTestId("add-text").click();
  await saveDesign(page);
  await page.getByTestId("tab-check").click();
  await page.getByTestId("add-to-cart").click();
  await expect(page.getByText("Added to cart")).toBeVisible();
  await page.goto("/checkout");
  await page.getByTestId("addr-fullName").fill("Partner Journey Buyer");
  await page.getByTestId("addr-phone").fill("9811122233");
  await page.getByTestId("addr-line1").fill("5 Residency Road");
  await page.getByTestId("addr-city").fill("Bengaluru");
  await page.getByTestId("addr-state").fill("Karnataka");
  await page.getByTestId("addr-pincode").fill("560025");
  await page.getByTestId("place-order").click();
  await page.waitForURL(/\/orders\//);
  await page.getByTestId("simulate-payment").click();
  await expect(page.getByText(/awaiting production approval/i).first()).toBeVisible();
  return page.url();
}

async function applyAsPartner(page: Page, type: "manufacturer" | "logistics", name: string, email: string) {
  await page.goto("/partners");
  const form = page.getByTestId("partner-apply");
  if (type === "logistics") await form.getByRole("radio", { name: "Logistics" }).click();
  await form.getByLabel("Business name", { exact: true }).fill(name);
  await form.getByLabel("Contact email").fill(email);
  await form.getByLabel("City", { exact: true }).fill(type === "manufacturer" ? "Tiruppur" : "Bengaluru");
  await page.getByTestId("partner-apply-submit").click();
  await page.waitForURL("**/partner");
  await expect(page.getByText("Application under review")).toBeVisible();
}

test("manufacturer & logistics portals: approval → production → QC → shipping → delivery → dispute", async ({ page }) => {
  test.setTimeout(300_000);
  page.on("dialog", (d) => d.accept(d.type() !== "prompt" ? undefined : /reference/i.test(d.message()) ? "UTR-E2E-000123" : "Replacement tee sent with the next dispatch."));
  const stamp = Date.now().toString(36);
  const makerName = `Loomcraft ${stamp}`;
  const shipperName = `SwiftRoute ${stamp}`;

  // Customer places and pays (simulated) for an order.
  const buyer = await register(page, "Partner Buyer");
  const orderUrl = await placePaidOrder(page);
  const orderId = orderUrl.split("/").pop()!;
  await logout(page);

  // Manufacturer and logistics companies apply.
  const maker = await register(page, "Maker Owner", uniqueEmail("maker"));
  await applyAsPartner(page, "manufacturer", makerName, maker);
  // Pending partners are blocked from the job APIs.
  expect((await page.request.get("/api/partner/jobs")).status()).toBe(403);
  await logout(page);
  const shipper = await register(page, "Shipper Owner", uniqueEmail("shipper"));
  await applyAsPartner(page, "logistics", shipperName, shipper);
  await logout(page);

  // Admin approves both, approves the item and assigns the manufacturer.
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin/partners");
  for (const name of [makerName, shipperName]) {
    await page.getByTestId("partner-row").filter({ hasText: name }).getByTestId("partner-approve").click();
    await expect(page.getByTestId("partner-row").filter({ hasText: name })).toHaveCount(0);
  }
  await page.goto(`/admin/orders/${orderId}`);
  await page.getByTestId("approve-item").click();
  await expect(page.getByText(/approved for production/i).first()).toBeVisible();
  await page.getByTestId("assign-maker").selectOption({ label: `${makerName} ✓ capable` });
  await page.getByTestId("assign-submit").click();
  await expect(page.getByTestId("fulfil-job").filter({ hasText: makerName })).toContainText("New offer");
  await logout(page);

  // Manufacturer: accept, quote.
  await login(page, maker);
  await page.goto("/partner");
  await page.getByTestId("partner-jobs").getByRole("link").first().click();
  await expect(page.getByTestId("partner-job")).toBeVisible();
  await expect(page.getByTestId("job-item")).toContainText("quantity 1");
  await expect(page.getByTestId("partner-job")).not.toContainText("Residency Road"); // no customer address for manufacturers
  const jobUrl = page.url();
  const jobId = jobUrl.split("/").pop()!;
  const pdf = await page.request.get(`/api/partner/jobs/${jobId}/techpack?item=${await page.getByTestId("job-techpack").getAttribute("href").then((h) => h!.split("item=")[1])}`);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  await page.getByTestId("job-accept").click();
  await page.getByTestId("quote-fabric").fill("320");
  await page.getByTestId("quote-print").fill("180");
  await page.getByTestId("quote-labour").fill("150");
  await page.getByTestId("quote-submit").click();
  await expect(page.getByText("Quote submitted").first()).toBeVisible();
  // Isolation: a manufacturer cannot use the logistics API.
  expect((await page.request.get("/api/partner/shipments")).status()).toBe(403);
  await logout(page);

  // Admin approves the quotation from the production board.
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin/production");
  await page.getByTestId("board-row").filter({ hasText: makerName }).getByTestId("quote-approve").click();
  await expect(page.getByTestId("board-row").filter({ hasText: makerName })).toContainText("Quote approved");
  await logout(page);

  // Manufacturer: stage → QC pass → ready to dispatch.
  await login(page, maker);
  await page.goto(jobUrl);
  await page.getByLabel("Stage").selectOption("cutting");
  await page.getByTestId("stage-submit").click();
  await expect(page.getByTestId("partner-job")).toContainText("stage: cutting");
  await page.getByLabel("Stage").selectOption("sewing");
  await page.getByTestId("stage-submit").click();
  await expect(page.getByTestId("partner-job")).toContainText("stage: sewing");
  await page.getByTestId("qc-submit").click();
  await expect(page.getByTestId("job-ready")).toBeVisible();
  await page.getByTestId("job-ready-submit").click();
  await expect(page.getByText(/awaiting courier pickup/i)).toBeVisible();
  await logout(page);

  // Admin books the shipment with the logistics partner.
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto(`/admin/orders/${orderId}`);
  await expect(page.getByTestId("admin-order")).toContainText("packed");
  await page.getByTestId("shipment-partner").selectOption({ label: shipperName });
  await page.getByTestId("shipment-rate").fill("85");
  await page.getByTestId("shipment-submit").click();
  await expect(page.getByTestId("fulfil-shipment")).toContainText("assigned");
  await logout(page);

  // Logistics: label → pickup → transit → delivery with proof.
  await login(page, shipper);
  expect((await page.request.get("/api/partner/jobs")).status()).toBe(403);
  expect((await page.request.get(`/api/partner/jobs/${jobId}`)).status()).toBe(403);
  await page.goto("/partner");
  await page.getByTestId("partner-shipments").getByRole("link").first().click();
  await expect(page.getByTestId("partner-shipment")).toContainText("Residency Road");
  await expect(page.getByTestId("partner-shipment")).toContainText(makerName);
  await page.getByTestId("label-generate").click();
  await expect(page.getByTestId("label-download")).toBeVisible();
  const label = await page.request.get(await page.getByTestId("label-download").getAttribute("href").then((h) => h!));
  expect(label.headers()["content-type"]).toBe("application/pdf");
  for (const [status, location] of [["picked_up", "Tiruppur"], ["in_transit", "Bengaluru hub"], ["out_for_delivery", "Bengaluru"]]) {
    await page.getByTestId("track-status").selectOption(status);
    await page.getByTestId("track-location").fill(location);
    await page.getByTestId("track-submit").click();
    await expect(page.getByTestId("ship-events")).toContainText(status.replace(/_/g, " "));
  }
  await page.getByTestId("track-status").selectOption("delivered");
  await page.getByTestId("track-pod-name").fill("Partner Buyer");
  await page.getByTestId("track-submit").click();
  await expect(page.getByTestId("partner-shipment")).toContainText("Received by Partner Buyer");
  await logout(page);

  // Customer sees delivery + tracking (no partner names), reports a problem.
  await login(page, buyer);
  await page.goto(orderUrl);
  await expect(page.getByTestId("order-tracking")).toContainText("delivered");
  await expect(page.getByTestId("order-tracking")).toContainText("Received by Partner Buyer");
  await expect(page.getByTestId("order-detail")).not.toContainText(makerName);
  await expect(page.getByTestId("order-detail")).not.toContainText(shipperName);
  await page.getByTestId("dispute-open").click();
  await page.getByTestId("dispute-text").fill("The neck label is stitched upside down.");
  await page.getByTestId("dispute-submit").click();
  await expect(page.getByTestId("my-disputes")).toContainText("open");
  // Another customer cannot raise a dispute on this order.
  const r = await page.request.post("/api/disputes", { headers: ORIGIN, data: { orderId: "00000000-0000-4000-8000-000000000000", kind: "other", description: "Not my order at all." } });
  expect(r.status()).toBe(404);
  await logout(page);

  // Admin resolves it; the customer sees the resolution.
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin/disputes");
  await page.getByTestId("dispute-row").filter({ hasText: "neck label" }).getByTestId("dispute-resolve").click();
  await page.getByRole("button", { name: "Resolved" }).click();
  await expect(page.getByTestId("dispute-row").filter({ hasText: "neck label" })).toContainText("Replacement tee");
  // Payouts: the approved quotation (650) accrued at pickup; the agreed rate (85) at delivery.
  await page.goto("/admin/payouts");
  const makerPayout = page.getByTestId("settlement-row").filter({ hasText: makerName });
  await expect(makerPayout).toContainText("₹650");
  await expect(page.getByTestId("settlement-row").filter({ hasText: shipperName })).toContainText("₹85");
  await makerPayout.getByTestId("settlement-pay").click();
  await expect(makerPayout).toHaveCount(0); // moved out of "Due"
  const csv = await page.request.get("/api/admin/settlements?format=csv&status=paid");
  expect(await csv.text()).toContain("UTR-E2E-000123");
  for (const p of ["/admin/shipping", "/admin/partners"]) {
    await page.goto(p);
    await expect(page.locator("h1")).toBeVisible();
  }
  await logout(page);
  await login(page, buyer);
  await page.goto(orderUrl);
  await expect(page.getByTestId("my-disputes")).toContainText("Replacement tee");
  await logout(page);

  // The manufacturer sees its payout (and the notification in its mailbox).
  await login(page, maker);
  await page.goto("/partner/payouts");
  await expect(page.getByTestId("payout-row").first()).toContainText("paid");
  await expect(page.getByTestId("payout-row").first()).toContainText("UTR-E2E-000123");
  await page.goto("/account/mailbox");
  await expect(page.getByTestId("mail").filter({ hasText: "New production offer" })).toHaveCount(1);
  expect((await page.request.get("/api/admin/settlements")).status()).toBe(403);
});
