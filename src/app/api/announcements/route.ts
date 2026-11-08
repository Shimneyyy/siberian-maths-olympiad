import { olympiadRequest } from "@/lib/olympiad-api";
import { saveAnnouncement } from "@/lib/announcements";
import { db } from "@/lib/db";
export const POST = (request: Request) => olympiadRequest(request, (actorId, body) => saveAnnouncement(db, actorId, body));
