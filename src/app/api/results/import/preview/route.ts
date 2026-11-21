import { RESULT_IMPORT_BODY_LIMIT } from "@/lib/result-csv-limits";
import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { previewResultImport } from "@/lib/result-imports";
export async function POST(request: Request) { return olympiadRequest(request, (actorId, body) => previewResultImport(db, actorId, body), RESULT_IMPORT_BODY_LIMIT); }
