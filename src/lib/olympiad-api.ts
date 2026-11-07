import "server-only";
import { z } from "zod";
import { APIError } from "better-auth/api";
import { auth } from "./auth";
import { db } from "./db";
import { AccessDenied } from "./access";
import { BodyTooLarge, readJsonBody } from "./http-body";
import { OlympiadError } from "./olympiad-rules";
import { AdminRateLimit } from "./admin";
import { Prisma } from "@prisma/client";
const headers = { "Cache-Control": "private, no-store" };
export async function olympiadRequest(request: Request, operation: (actorId: string, body: unknown) => Promise<unknown>) {
  if (request.method !== "GET" && request.headers.get("origin") !== new URL(process.env.BETTER_AUTH_URL || "http://localhost:3000").origin) return Response.json({ error: "Недопустимый источник запроса" }, { status: 403, headers });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user.emailVerified) return Response.json({ error: "Необходим вход" }, { status: 401, headers });
  let body: unknown;
  try {
    if (request.method !== "GET") body = (await readJsonBody(request)).value;
    const result = await operation(session.user.id, body);
    if (result instanceof Response) return result;
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof AdminRateLimit) return Response.json({ error: "Слишком много попыток" }, { status: 429, headers });
    if (error instanceof BodyTooLarge) return Response.json({ error: "Слишком большой запрос" }, { status: 413, headers });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "Проверьте поля формы" }, { status: 400, headers });
    if (error instanceof APIError || error instanceof AccessDenied) {
      const scope = z.object({ editionId: z.uuid() }).safeParse(body);
      if (scope.success) await db.auditEvent.create({ data: { actorId: session.user.id, action: "ACCESS_DENIED", objectType: "OlympiadEdition", objectId: scope.data.editionId, editionId: scope.data.editionId, outcome: "DENIED" } });
      return Response.json({ error: error instanceof AccessDenied && error.reason === "MFA_REQUIRED" ? "Сначала настройте TOTP" : "Действие недоступно" }, { status: 403, headers });
    }
    if (error instanceof OlympiadError) return Response.json({ error: error.message, code: error.code }, { status: error.code === "NOT_FOUND" ? 404 : 409, headers });
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2003", "P2034"].includes(error.code)) return Response.json({ error: "Конфликт данных. Обновите страницу и повторите действие." }, { status: 409, headers });
    return Response.json({ error: "Не удалось выполнить действие. Повторите позже." }, { status: 503, headers });
  }
}
