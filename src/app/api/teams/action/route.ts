import { olympiadRequest } from "@/lib/olympiad-api";
import { teamAction } from "@/lib/team-actions";
import { db } from "@/lib/db";
export const POST = (request: Request) => olympiadRequest(request, (actorId, body) => teamAction(db, actorId, body));
