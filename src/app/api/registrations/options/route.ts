import { olympiadRequest } from "@/lib/olympiad-api";
import { registrationsOptions } from "@/lib/registrations";
import { db } from "@/lib/db";
export const GET = (request: Request) => olympiadRequest(request, (actorId) => registrationsOptions(db, actorId));
