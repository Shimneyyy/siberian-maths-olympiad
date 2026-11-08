import { olympiadRequest } from "@/lib/olympiad-api";
import { mailBatchesView } from "@/lib/mail-batches";
import { db } from "@/lib/db";
export const POST = (request: Request) => olympiadRequest(request, (actorId, body) => mailBatchesView(db, actorId, body));
