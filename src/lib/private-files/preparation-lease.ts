import type { PrismaClient } from "@prisma/client";
import { OlympiadError } from "../olympiad-rules";
export async function withPreparationLease<T>(db:PrismaClient,actorId:string,operation:()=>Promise<T>) {
  return db.$transaction(async tx=>{
    const [actor]=await tx.$queryRaw<{ok:boolean}[]>`SELECT pg_try_advisory_xact_lock(4730,hashtext(${actorId})) AS ok`;
    if(!actor.ok)throw new OlympiadError("CONFLICT","Предыдущая загрузка ещё обрабатывается");
    for(let slot=0;slot<2;slot++) {
      const [global]=await tx.$queryRaw<{ok:boolean}[]>`SELECT pg_try_advisory_xact_lock(4731,${slot}::int) AS ok`;
      if(global.ok)return operation();
    }
    throw new OlympiadError("CONFLICT","Проверяются другие пакеты. Повторите загрузку позже.");
  },{timeout:480000,maxWait:3000});
}
