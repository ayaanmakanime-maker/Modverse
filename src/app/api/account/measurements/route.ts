import { route } from "@/lib/api/handler";
import { listMeasurementProfiles, measurementProfileSchema, upsertMeasurementProfile } from "@/lib/services/account";

export const GET = route({ auth: "user" }, async ({ user }) => ({ profiles: await listMeasurementProfiles(user) }));
export const POST = route({ auth: "user" }, async ({ user, body }) => ({ profile: await upsertMeasurementProfile(user, await body(measurementProfileSchema)) }));
