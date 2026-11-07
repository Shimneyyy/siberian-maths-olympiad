import { olympiadRequest } from "@/lib/olympiad-api";
import { saveRegistrationWindow } from "@/lib/admin";
import { db } from "@/lib/db";
export const POST = (request: Request) => olympiadRequest(request, (actorId, body) => saveRegistrationWindow(db, actorId, body));
