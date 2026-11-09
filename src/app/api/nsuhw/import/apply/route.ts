import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { applyAccountImport } from "@/lib/account-imports";
export async function POST(request: Request) { return olympiadRequest(request, (actorId, body) => applyAccountImport(db, actorId, body), 1048576); }
