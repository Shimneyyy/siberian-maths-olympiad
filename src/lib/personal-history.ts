import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { publishedResultDocuments } from "./result-documents";
export async function personalHistory(db:PrismaClient,actorId:string,rawPage:unknown=1){
 const page=z.coerce.number().int().min(1).max(10000).parse(rawPage);
 return publishedResultDocuments(db,actorId,undefined,page);
}
