import { z } from "zod";
import { APIError } from "better-auth/api";
import { AccessDenied } from "./access";
import { BodyTooLarge, readJsonBody } from "./http-body";
import { OlympiadError } from "./olympiad-rules";
import { UnsafeZip } from "./private-files/zip-preview";
import { PdfInspectorUnavailable } from "./private-files/pdf-inspection";
import { ScannerUnavailable } from "./private-files/clamav";
import { InvalidMailTemplate } from "./mail-template";
import { AdminRateLimit } from "./admin";
import { Prisma } from "@prisma/client";
export type RequestSession = {user:{id:string;email:string;emailVerified:boolean}};
export type RequestDependencies = {session:(headers:Headers)=>Promise<RequestSession|null>;denialAudit:(actorId:string,editionId:string)=>Promise<unknown>};
const headers = { "Cache-Control": "private, no-store" };
export async function executeOlympiadRequest(request: Request, deps: RequestDependencies, operation: (actorId: string, body: unknown) => Promise<unknown>, bodyLimit = 16384, decodeBody?: (actorId: string) => Promise<unknown>) {
  let session: RequestSession | null = null;
  let body: unknown;
  try {
  if (request.method !== "GET" && request.headers.get("origin") !== new URL(process.env.BETTER_AUTH_URL || "http://localhost:3000").origin) return Response.json({ error: "Недопустимый источник запроса" }, { status: 403, headers });
  session = await deps.session(request.headers);
  if (!session?.user.emailVerified) return Response.json({ error: "Необходим вход" }, { status: 401, headers });
    if (request.method !== "GET") body = decodeBody ? await decodeBody(session.user.id) : (await readJsonBody(request, bodyLimit)).value;
    const result = await operation(session.user.id, body);
    if (result instanceof Response) return result;
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof UnsafeZip) return Response.json({ error: "ZIP повреждён, зашифрован или превышает ограничения. Проверьте архив и размеры файлов." }, { status: 400, headers });
    if (error instanceof PdfInspectorUnavailable || error instanceof ScannerUnavailable) return Response.json({ error: "Проверка файлов временно недоступна. Повторите позже." }, { status: 503, headers });
    if (error instanceof InvalidMailTemplate) return Response.json({ error: "Проверьте разрешённые переменные шаблона" }, { status: 400, headers });
    if (error instanceof AdminRateLimit) return Response.json({ error: "Слишком много попыток" }, { status: 429, headers });
    if (error instanceof BodyTooLarge) return Response.json({ error: "Слишком большой запрос" }, { status: 413, headers });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "Проверьте поля формы" }, { status: 400, headers });
    if (error instanceof APIError || error instanceof AccessDenied) {
      const scope = z.object({ editionId: z.uuid() }).safeParse(body);
      if (scope.success && session) {
        try { await deps.denialAudit(session.user.id,scope.data.editionId); }
        catch { return Response.json({error:"Не удалось выполнить действие. Повторите позже."},{status:503,headers}); }
      }
      return Response.json({ error: "Действие недоступно" }, { status: 403, headers });
    }
    if (error instanceof OlympiadError) return Response.json({ error: error.message, code: error.code }, { status: error.code === "NOT_FOUND" ? 404 : 409, headers });
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2003", "P2034"].includes(error.code)) return Response.json({ error: "Конфликт данных. Обновите страницу и повторите действие." }, { status: 409, headers });
    if (process.env.SMO_SYNTHETIC_DIAGNOSTICS === "true" && process.env.DEMO_REGISTRATION === "true" && session?.user.email.endsWith("@example.test")) {
      const code = error instanceof Prisma.PrismaClientKnownRequestError && /^P\d{4}$/.test(error.code) ? error.code : "UNCLASSIFIED";
      console.error(`SYNTHETIC_API_FAILURE:${code}`); // Never log message, body, IDs, SQL or parameters.
    }
    return Response.json({ error: "Не удалось выполнить действие. Повторите позже." }, { status: 503, headers });
  }
}
