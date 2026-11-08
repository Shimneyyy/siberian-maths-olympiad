import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { applyResultImport } from "@/lib/result-imports";
export async function POST(request: Request) { return olympiadRequest(request, (actorId, body) => applyResultImport(db, actorId, body), 1048576); }
