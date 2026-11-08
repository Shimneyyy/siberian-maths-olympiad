import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { reviewResultImports } from "@/lib/result-imports";
export async function POST(request: Request) { return olympiadRequest(request, (actorId, body) => reviewResultImports(db, actorId, body)); }
