import { olympiadRequest } from "@/lib/olympiad-api";
import { catalogsView,saveCatalog } from "@/lib/catalogs";
import { db } from "@/lib/db";
export const POST=(request:Request)=>olympiadRequest(request,(actorId,body)=>saveCatalog(db,actorId,body));
export const GET=(request:Request)=>olympiadRequest(request,actorId=>catalogsView(db,actorId,{editionId:new URL(request.url).searchParams.get("editionId")}));
