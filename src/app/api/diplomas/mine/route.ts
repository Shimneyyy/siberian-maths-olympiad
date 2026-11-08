import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { ownDiplomas } from "@/lib/diplomas";
export async function GET(request: Request) { return olympiadRequest(request,actorId=>ownDiplomas(db,actorId)); }
