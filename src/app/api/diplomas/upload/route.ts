import { z } from "zod";
import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { diplomaChief, prepareDiplomaBatch } from "@/lib/diplomas";
import { BodyTooLarge } from "@/lib/http-body";
export async function POST(request: Request) {
  return olympiadRequest(request,(actorId,body)=>prepareDiplomaBatch(db,actorId,body),16384,async actorId=>{
    const editionId=z.uuid().parse(new URL(request.url).searchParams.get("editionId"));
    await diplomaChief(db,actorId,editionId);
    if(!request.body)throw new SyntaxError();const reader=request.body.getReader();const chunks:Uint8Array[]=[];let length=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>50*1024*1024+16384){await reader.cancel();throw new BodyTooLarge();}chunks.push(value);}}finally{reader.releaseLock();}
    const buffer=new Uint8Array(length);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
    let form:FormData;try{form=await new Response(buffer,{headers:{"Content-Type":request.headers.get("content-type")||""}}).formData();}catch{throw new SyntaxError();}
    const file=form.get("file");if(!(file instanceof File))throw new SyntaxError();if(file.size>50*1024*1024)throw new BodyTooLarge();
    if([...form.keys()].some(k=>!["id","file","password","confirmed"].includes(k))||[...form.keys()].some(k=>form.getAll(k).length!==1))throw new SyntaxError();
    return {editionId,id:form.get("id"),bytes:new Uint8Array(await file.arrayBuffer()),password:form.get("password"),confirmed:form.get("confirmed")==="true"};
  });
}
