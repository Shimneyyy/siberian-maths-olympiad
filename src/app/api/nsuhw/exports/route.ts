import { olympiadRequest } from "@/lib/olympiad-api";
import { downloadNsuhwExport } from "@/lib/nsuhw-export";
import { AccessDenied } from "@/lib/access";
import { db } from "@/lib/db";
export const POST=(request:Request)=>olympiadRequest(request,async(actorId,body)=>{
 const url=new URL(request.url);if(url.protocol!=="https:"&&!["localhost","127.0.0.1"].includes(url.hostname))throw new AccessDenied("FORBIDDEN");
 const result=await downloadNsuhwExport(db,actorId,body);
 return new Response(result.csv,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="${result.filename}"`,"Cache-Control":"private, no-store","Pragma":"no-cache","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox"}});
});
