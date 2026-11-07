import { olympiadRequest } from "@/lib/olympiad-api";
import { cancelParticipation } from "@/lib/cancellation";
import { db } from "@/lib/db";
export const POST = (request: Request) => olympiadRequest(request, (actorId, body) => cancelParticipation(db, actorId, body));
