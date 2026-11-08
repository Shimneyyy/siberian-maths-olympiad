import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { resultsView } from "@/lib/results";
export async function POST(request: Request) { return olympiadRequest(request, (actorId, body) => resultsView(db, actorId, body)); }
