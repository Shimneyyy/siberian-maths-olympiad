import { BodyTooLarge, readJsonBody } from "@/lib/http-body";
import { createHash } from "node:crypto";
import { auth } from "@/lib/auth";
import { createAuth, type Mail } from "@/lib/auth-core";
import { db } from "@/lib/db";
import { submitLegacyNsuhwInTransaction } from "@/lib/legacy-nsuhw";
import { sendMail } from "@/lib/mail";
import { registrationSchema, DEMO_CONSENT_TEXT, DEMO_CONSENT_VERSION } from "@/lib/registration-rules";

class AuthResponseError extends Error {
  constructor(readonly response: Response) { super("Authentication rejected"); }
}

// Expose only implemented flows. No social login, email change or passwordless login.
const routes = new Set([
  "sign-up/email", "sign-in/email", "sign-out", "get-session", "request-password-reset", "reset-password",
  "email-otp/send-verification-otp", "email-otp/verify-email",
  "two-factor/enable", "two-factor/verify-totp", "two-factor/verify-backup-code",
]);
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  const path = new URL(request.url).pathname.replace(/^\/api\/auth\//, "");
  if (!routes.has(path) && !(request.method === "GET" && /^reset-password\/[a-zA-Z0-9_-]+$/.test(path))) return Response.json({ error: "Not found" }, { status: 404 });
  if (request.method === "POST" && request.headers.get("origin") !== new URL(process.env.BETTER_AUTH_URL || "http://localhost:3000").origin) {
    return Response.json({ error: "Forbidden origin" }, { status: 403 });
  }
  if (request.method !== "POST" || path !== "sign-up/email") return auth.handler(request);
  if (Number(request.headers.get("content-length") || 0) > 16384) return Response.json({ error: "Too large" }, { status: 413 });
  let body: unknown;
  let raw: string;
  try { ({ value: body, raw } = await readJsonBody(request)); } catch (error) { return Response.json({ error: "Invalid body" }, { status: error instanceof BodyTooLarge ? 413 : 400 }); }
  const authRequest = new Request(request.url, { method: request.method, headers: request.headers, body: raw });
  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Проверьте поля регистрации" }, { status: 400 });
  const outgoing: Mail[] = [];
  try {
    const response = await db.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: parsed.data.email } });
      const scopedAuth = createAuth(tx, async (mail) => { outgoing.push(mail); }, false);
      const result = await scopedAuth.handler(authRequest);
      if (!result.ok) throw new AuthResponseError(result);
      if (existing) return result;
      const user = await tx.user.findUnique({ where: { email: parsed.data.email } });
      if (!user) return result; // Rate-limit / generic library responses cannot create a profile.
      await tx.studentProfile.create({ data: { userId: user.id, fullName: parsed.data.name, universityId: parsed.data.universityId, courseId: parsed.data.courseId } });
      await tx.consentRecord.create({ data: { userId: user.id, purpose: "synthetic-demo-only", textVersion: DEMO_CONSENT_VERSION, textHash: createHash("sha256").update(DEMO_CONSENT_TEXT).digest("hex") } });
      if (parsed.data.firstNameLatin && parsed.data.lastNameLatin) await tx.nsuhwLoginName.create({data:{userId:user.id,firstNameLatin:parsed.data.firstNameLatin,lastNameLatin:parsed.data.lastNameLatin}});
      if (parsed.data.legacyNsuhwLogin) await submitLegacyNsuhwInTransaction(tx, user.id, parsed.data.legacyNsuhwLogin);
      await tx.auditEvent.create({ data: { actorId: user.id, action: "ACCOUNT_REGISTERED", objectType: "User", objectId: user.id, outcome: "SUCCESS" } });
      return result;
    }, { timeout: 15000 });
    // Never send a verification code for an account rolled back with its profile.
    for (const mail of outgoing) await sendMail(mail);
    return response;
  } catch (error) {
    if (error instanceof AuthResponseError) return error.response;
    return Response.json({ error: "Не удалось завершить регистрацию. Если аккаунт создан, запросите код повторно." }, { status: 503 });
  }
}
async function dispatch(request: Request) {
  if (request.method === "POST") {
    try {
      const { raw } = await readJsonBody(request);
      request = new Request(request.url, { method: request.method, headers: request.headers, body: raw });
    } catch (error) {
      return Response.json({ error: "Invalid body" }, { status: error instanceof BodyTooLarge ? 413 : 400, headers: { "Cache-Control": "no-store" } });
    }
  }
  const response = await handle(request);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
export const GET = dispatch;
export const POST = dispatch;
