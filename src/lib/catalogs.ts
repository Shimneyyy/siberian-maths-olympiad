import { z } from "zod";
import { Prisma, type PrismaClient } from "@prisma/client";
import { authorizeStaff } from "./access";
import { reauthenticateParticipationChief } from "./corrections";
import { assertDemoRegistration } from "./registration-rules";
import { OlympiadError } from "./olympiad-rules";
const scope=z.object({editionId:z.uuid()}).strict();
const schema=scope.extend({kind:z.enum(["university","course"]),id:z.uuid().optional(),revision:z.int().nonnegative().optional(),name:z.string().trim().min(1).max(200),abbreviation:z.string().trim().min(1).max(30).optional(),active:z.boolean(),password:z.string().min(1).max(128)}).strict();
export async function catalogsView(db:PrismaClient,actorId:string,raw:unknown) {
  const input=scope.parse(raw);
  return db.$transaction(async tx=>{
    await authorizeStaff(tx,actorId,"edition:manage",input.editionId);
    const universities=await tx.university.findMany({orderBy:{name:"asc"}});
    const courses=await tx.courseOption.findMany({orderBy:{label:"asc"}});
    return {universities,courses};
  },{isolationLevel:"RepeatableRead"});
}
export async function saveCatalog(db:PrismaClient,actorId:string,raw:unknown) {
  const input=schema.parse(raw);
  if(input.kind==="university"&&!input.abbreviation)throw new OlympiadError("CONFLICT","Укажите аббревиатуру вуза");
  if(!!input.id!==(input.revision!==undefined))throw new OlympiadError("CONFLICT","Обновите справочник");
  await authorizeStaff(db,actorId,"edition:manage",input.editionId);
  assertDemoRegistration((await db.user.findUniqueOrThrow({where:{id:actorId}})).email);
  await reauthenticateParticipationChief(db,actorId,input.password);
  return db.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(4726,50)`;
    await authorizeStaff(tx,actorId,"edition:manage",input.editionId);
    const old=input.id?(input.kind==="university"?await tx.university.findUnique({where:{id:input.id}}):await tx.courseOption.findUnique({where:{id:input.id}})):null;
    if(input.id&&(!old||old.revision!==input.revision))throw new OlympiadError("CONFLICT","Справочник уже изменён. Обновите страницу.");
    const duplicate=input.kind==="university"?await tx.university.findFirst({where:{name:{equals:input.name,mode:"insensitive"},...(input.id?{id:{not:input.id}}:{})}}):await tx.courseOption.findFirst({where:{label:{equals:input.name,mode:"insensitive"},...(input.id?{id:{not:input.id}}:{})}});
    if(duplicate)throw new OlympiadError("CONFLICT","Такое значение уже есть в справочнике");
    const item=input.kind==="university"?
      input.id?await tx.university.update({where:{id:input.id},data:{name:input.name,abbreviation:input.abbreviation,active:input.active,revision:{increment:1}}}):await tx.university.create({data:{name:input.name,abbreviation:input.abbreviation!,active:input.active}}):
      input.id?await tx.courseOption.update({where:{id:input.id},data:{label:input.name,active:input.active,revision:{increment:1}}}):await tx.courseOption.create({data:{label:input.name,active:input.active}});
    await tx.auditEvent.create({data:{actorId,action:"CATALOG_SAVED",objectType:input.kind==="university"?"University":"CourseOption",objectId:item.id,editionId:input.editionId,outcome:"SUCCESS",details:{revision:item.revision,active:item.active}}});
    return {id:item.id,revision:item.revision};
  });
}

const deleteSchema = scope.extend({
  kind: z.enum(["university", "course"]), id: z.uuid(), revision: z.int().nonnegative(),
  password: z.string().min(1).max(128),
}).strict();

export async function deleteCatalog(db: PrismaClient, actorId: string, raw: unknown) {
  const input = deleteSchema.parse(raw);
  await authorizeStaff(db, actorId, "edition:manage", input.editionId);
  assertDemoRegistration((await db.user.findUniqueOrThrow({ where: { id: actorId } })).email);
  await reauthenticateParticipationChief(db, actorId, input.password);
  try {
    return await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4726,50)`;
      await authorizeStaff(tx, actorId, "edition:manage", input.editionId);
      const where = { id: input.id, revision: input.revision };
      const university = input.kind === "university";
      const result = university ? await tx.university.deleteMany({ where }) : await tx.courseOption.deleteMany({ where });
      if (!result.count) throw new OlympiadError("CONFLICT", "Справочник уже изменён. Обновите страницу.");
      await tx.auditEvent.create({ data: { actorId, action: "CATALOG_DELETED", objectType: university ? "University" : "CourseOption",
        objectId: input.id, editionId: input.editionId, outcome: "SUCCESS", details: { revision: input.revision } } });
      return { id: input.id };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new OlympiadError("CONFLICT", "Запись уже используется. Её можно отключить в справочнике.");
    }
    throw error;
  }
}
