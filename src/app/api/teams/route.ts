import { olympiadRequest } from "@/lib/olympiad-api";
import { createTeam, teamsView } from "@/lib/teams";
import { db } from "@/lib/db";
export const GET = (request: Request) => olympiadRequest(request, actorId => teamsView(db, actorId));
export const POST = (request: Request) => olympiadRequest(request, (actorId, body) => createTeam(db, actorId, body));
