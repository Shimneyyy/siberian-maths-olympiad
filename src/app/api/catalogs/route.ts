import { olympiadRequest } from "@/lib/olympiad-api";
import { catalogsView,deleteCatalog,saveCatalog } from "@/lib/catalogs";
import { db } from "@/lib/db";
export const POST=(request:Request)=>olympiadRequest(request,(actorId,body)=>saveCatalog(db,actorId,body));
export const GET=(request:Request)=>olympiadRequest(request,actorId=>catalogsView(db,actorId,{editionId:new URL(request.url).searchParams.get("editionId")}));
export const DELETE=(request:Request)=>olympiadRequest(request,(actorId,body)=>deleteCatalog(db,actorId,body));
