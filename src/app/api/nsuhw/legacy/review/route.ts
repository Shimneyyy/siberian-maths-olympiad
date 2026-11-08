import { olympiadRequest } from "@/lib/olympiad-api";
import { legacyNsuhwReviewList } from "@/lib/legacy-nsuhw";
import { db } from "@/lib/db";
export const POST = (request:Request) => olympiadRequest(request,(actorId,body)=>legacyNsuhwReviewList(db,actorId,body));
