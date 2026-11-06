import { randomUUID } from "node:crypto";
import { BodyTooLarge, readJsonBody } from "@/lib/http-body";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { AccessDenied } from "@/lib/access";
import { assignVenueStaff, revokeVenueStaff } from "@/lib/staff";
const assignment = z.object({ editionId: z.uuid(), editionVenueId: z.uuid(), email: z.email().transform((s) => s.toLowerCase()), name: z.string().trim().min(3).max(200) });
const revocation = z.object({ editionId: z.uuid(), editionVenueId: z.uuid(), userId: z.uuid() });
const headers = { "Cache-Control": "private, no-store" };
async function handle(request: Request, revoke: boolean) {
  if (request.headers.get("origin") !== new URL(process.env.BETTER_AUTH_URL || "http://localhost:3000").origin) return Response.json({ error: "Forbidden" }, { status: 403, headers });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user.emailVerified) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  let body: unknown;
  try { body = (await readJsonBody(request)).value; } catch (error) { return Response.json({ error: "Invalid body" }, { status: error instanceof BodyTooLarge ? 413 : 400, headers }); }
  if (session.user.role !== "CHIEF_ORGANIZER" || !session.user.twoFactorEnabled) return Response.json({ error: "Forbidden" }, { status: 403, headers });
  const password = z.object({ password: z.string().min(1).max(128) }).safeParse(body);
  if (!password.success) return Response.json({ error: "Reauthentication required" }, { status: 400, headers });
  const now = BigInt(Date.now());
  const threshold = now - 60000n;
  const key = `staff-reauth:${session.user.id}`;
  const [bucket] = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("id", "key", "count", "lastRequest") VALUES (${randomUUID()}::uuid, ${key}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."lastRequest" < ${threshold} THEN 1 ELSE "RateLimit"."count" + 1 END,
      "lastRequest" = CASE WHEN "RateLimit"."lastRequest" < ${threshold} THEN ${now} ELSE "RateLimit"."lastRequest" END
    RETURNING "count"`;
  if (bucket.count > 5) return Response.json({ error: "Too many attempts" }, { status: 429, headers });
  try { await auth.api.verifyPassword({ headers: request.headers, body: password.data }); }
  catch { return Response.json({ error: "Reauthentication failed" }, { status: 403, headers }); }
  try {
    if (revoke) {
      const parsed = revocation.safeParse(body);
      if (!parsed.success) return Response.json({ error: "Invalid fields" }, { status: 400, headers });
      await revokeVenueStaff(db, session.user.id, parsed.data);
    } else {
      const parsed = assignment.safeParse(body);
      if (!parsed.success) return Response.json({ error: "Invalid fields" }, { status: 400, headers });
      if (process.env.NODE_ENV === "production" || !parsed.data.email.endsWith("@example.test")) return Response.json({ error: "Demo only" }, { status: 403, headers });
      await assignVenueStaff(db, session.user.id, parsed.data);
      await auth.api.requestPasswordReset({ body: { email: parsed.data.email, redirectTo: "/reset-password" }, headers: request.headers });
    }
    return Response.json({ status: "ok" }, { headers });
  } catch (error) {
    if (error instanceof AccessDenied) {
      const scope = z.object({ editionId: z.uuid() }).safeParse(body);
      if (scope.success) await db.auditEvent.create({ data: { actorId: session.user.id, action: "ACCESS_DENIED", objectType: "OlympiadEdition", objectId: scope.data.editionId, editionId: scope.data.editionId, outcome: "DENIED" } });
      return Response.json({ error: error.reason }, { status: 403, headers });
    }
    return Response.json({ error: "Operation failed" }, { status: 503, headers });
  }
}
export const POST = (request: Request) => handle(request, false);
export const DELETE = (request: Request) => handle(request, true);
