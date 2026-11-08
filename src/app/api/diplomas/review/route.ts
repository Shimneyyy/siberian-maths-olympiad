import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { diplomaBatchView } from "@/lib/diplomas";
export async function POST(request: Request) { return olympiadRequest(request,(actorId,body)=>diplomaBatchView(db,actorId,body),16384); }
