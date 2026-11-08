import { olympiadRequest } from "@/lib/olympiad-api";
import { announcementsView } from "@/lib/announcements";
import { db } from "@/lib/db";
export const POST = (request: Request) => olympiadRequest(request, (actorId, body) => announcementsView(db, actorId, body));
