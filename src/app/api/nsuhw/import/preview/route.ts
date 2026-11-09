import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { previewAccountImport } from "@/lib/account-imports";
export async function POST(request: Request) { return olympiadRequest(request, (actorId, body) => previewAccountImport(db, actorId, body), 1048576); }
