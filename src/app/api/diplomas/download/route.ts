import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { downloadDiploma } from "@/lib/diplomas";
export async function POST(request: Request) { return olympiadRequest(request,async(actorId,body)=>{
 const result=await downloadDiploma(db,actorId,body);
 return new Response(new Uint8Array(result.bytes),{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="diploma-${result.id}.pdf"`,"Cache-Control":"private, no-store","Pragma":"no-cache","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox"}});
}); }
