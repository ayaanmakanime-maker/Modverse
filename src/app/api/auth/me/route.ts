import { route } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const GET = route({}, async ({ user }) => {
  if (!user) return { user: null };
  const { sessionId: _s, ...rest } = user;
  return { user: rest };
});
