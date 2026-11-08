import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { applyDiplomaBatch } from "@/lib/diplomas";
export async function POST(request: Request) { return olympiadRequest(request,(actorId,body)=>applyDiplomaBatch(db,actorId,body),262144); }
