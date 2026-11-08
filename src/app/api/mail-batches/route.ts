import { olympiadRequest } from "@/lib/olympiad-api";
import { sendMailBatch } from "@/lib/mail-batches";
import { db } from "@/lib/db";
export const POST = (request: Request) => olympiadRequest(request, (actorId, body) => sendMailBatch(db, actorId, body));
