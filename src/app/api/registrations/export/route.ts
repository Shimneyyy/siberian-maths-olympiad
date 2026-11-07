import { olympiadRequest } from "@/lib/olympiad-api";
import { exportRegistrations } from "@/lib/registrations";
import { db } from "@/lib/db";
export const POST = (request: Request) => olympiadRequest(request, async (actorId, body) => new Response(await exportRegistrations(db, actorId, body), { headers: {
  "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="registrations.csv"',
  "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
} }));
