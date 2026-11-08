import { olympiadRequest } from "@/lib/olympiad-api";
import { publishAnnouncement } from "@/lib/announcements";
import { db } from "@/lib/db";
export const POST = (request: Request) => olympiadRequest(request, (actorId, body) => publishAnnouncement(db, actorId, body));
