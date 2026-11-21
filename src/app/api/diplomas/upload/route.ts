import { z } from "zod";
import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { diplomaChief, prepareDiplomaUpload } from "@/lib/diplomas";
import { BodyTooLarge } from "@/lib/http-body";
import { readUploadBody } from "@/lib/private-files/upload-body";
export async function POST(request: Request) {
  return olympiadRequest(request, async(actorId,body)=>{
    const {editionId}=z.object({editionId:z.uuid()}).strict().parse(body);
    return prepareDiplomaUpload(db,actorId,async()=>{
      const buffer=await readUploadBody(request,50*1024*1024+16384);
      let form:FormData;
      try{form=await new Response(buffer,{headers:{"Content-Type":request.headers.get("content-type")||""}}).formData();}catch{throw new SyntaxError();}
      const file=form.get("file");if(!(file instanceof File))throw new SyntaxError();if(file.size>50*1024*1024)throw new BodyTooLarge();
      if([...form.keys()].some(k=>!["id","file","password","confirmed"].includes(k))||[...form.keys()].some(k=>form.getAll(k).length!==1))throw new SyntaxError();
      return {editionId,id:form.get("id"),bytes:new Uint8Array(await file.arrayBuffer()),password:form.get("password"),confirmed:form.get("confirmed")==="true"};
    });
  },16384,async actorId=>{
    const editionId=z.uuid().parse(new URL(request.url).searchParams.get("editionId"));
    await diplomaChief(db,actorId,editionId);
    return {editionId};
  });
}
