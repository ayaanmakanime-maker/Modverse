import { z } from "zod";
import { route } from "@/lib/api/handler";
import { addMember, listMembers } from "@/lib/services/partners";

export const GET = route({ auth: "user" }, async ({ user }) => ({ members: await listMembers(user) }));
export const POST = route({ auth: "user", rate: { name: "partner-member", limit: 20, windowMs: 60 * 60_000, by: "user" } }, async ({ user, body }) => {
  const { email } = await body(z.object({ email: z.string().email() }));
  await addMember(user, email);
  return { members: await listMembers(user) };
});
