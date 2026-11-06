import { olympiadRequest } from "@/lib/olympiad-api";
import { listRegistrations } from "@/lib/registrations";
import { db } from "@/lib/db";
// Filters can contain personal data. Keep them in the body, outside URLs and history.
export const POST = (request: Request) => olympiadRequest(request, (actorId, body) => listRegistrations(db, actorId, body));
