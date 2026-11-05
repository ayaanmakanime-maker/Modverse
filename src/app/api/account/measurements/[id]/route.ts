import { route } from "@/lib/api/handler";
import { deleteMeasurementProfile, measurementProfileSchema, upsertMeasurementProfile } from "@/lib/services/account";

export const PATCH = route<{ id: string }>({ auth: "user" }, async ({ user, body, params }) => ({ profile: await upsertMeasurementProfile(user, await body(measurementProfileSchema), params.id) }));
export const DELETE = route<{ id: string }>({ auth: "user" }, async ({ user, params }) => {
  await deleteMeasurementProfile(user, params.id);
  return { ok: true };
});
