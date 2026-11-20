import "server-only";
import { auth } from "./auth";
import { db } from "./db";
import { executeOlympiadRequest } from "./request-handler";
export async function olympiadRequest(request:Request, operation:(actorId:string,body:unknown)=>Promise<unknown>, bodyLimit=16384, decodeBody?:(actorId:string)=>Promise<unknown>) {
  return executeOlympiadRequest(request,{
    session: headers => auth.api.getSession({headers}),
    denialAudit: (actorId,editionId) => db.auditEvent.create({data:{actorId,action:"ACCESS_DENIED",objectType:"OlympiadEdition",objectId:editionId,editionId,outcome:"DENIED"}}),
  },operation,bodyLimit,decodeBody);
}
