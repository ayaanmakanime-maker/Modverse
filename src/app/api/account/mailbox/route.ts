import { route } from "@/lib/api/handler";
import { mailbox } from "@/lib/services/account";

export const GET = route({ auth: "user" }, async ({ user }) => ({ emails: await mailbox(user), note: "Local simulated mailbox — shown because no email provider is configured." }));
