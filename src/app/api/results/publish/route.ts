import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { publishResults } from "@/lib/results";
export async function POST(request: Request) { return olympiadRequest(request, (actorId, body) => publishResults(db, actorId, body)); }
