import { olympiadRequest } from "@/lib/olympiad-api";
import { revealNsuhwSecret } from "@/lib/reveal-nsuhw";
import { db } from "@/lib/db";
export const POST=(request:Request)=>olympiadRequest(request,async(actorId,body)=>Response.json(await revealNsuhwSecret(db,actorId,body),{headers:{"Cache-Control":"private, no-store","Pragma":"no-cache","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}}));
