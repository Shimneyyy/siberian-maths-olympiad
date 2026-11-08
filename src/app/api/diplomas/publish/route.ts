import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { publishDiplomaBatch } from "@/lib/diplomas";
export async function POST(request: Request) { return olympiadRequest(request,(actorId,body)=>publishDiplomaBatch(db,actorId,body),16384); }
