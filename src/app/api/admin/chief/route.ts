import { olympiadRequest } from "@/lib/olympiad-api";
import { manageChief } from "@/lib/admin";
import { db } from "@/lib/db";
export const POST = (request: Request) => olympiadRequest(request, (actorId, body) => manageChief(db, actorId, body));
