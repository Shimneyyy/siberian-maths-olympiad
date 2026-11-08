import { olympiadRequest } from "@/lib/olympiad-api";
import { transferParticipation } from "@/lib/transfers";
import { db } from "@/lib/db";
export const POST = (request: Request) => olympiadRequest(request, (actorId, body) => transferParticipation(db, actorId, body));
