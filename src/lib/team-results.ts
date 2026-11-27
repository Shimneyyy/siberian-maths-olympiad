import { RESULT_CSV_LIMIT } from "./result-csv-limits";
import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { parseResultCsv } from "./result-csv";
import { resultChief } from "./result-documents";
import { reauthenticateParticipationChief } from "./corrections";
import { OlympiadError } from "./olympiad-rules";
const scope=z.object({editionId:z.uuid()}).strict();
const source=scope.extend({kind:z.enum(["PRELIMINARY","FINAL"]),csv:z.string().max(RESULT_CSV_LIMIT)}).strict();
function fingerprint(value:unknown){const key=process.env.BETTER_AUTH_SECRET;if(!key)throw new Error("Auth configuration required");return createHmac("sha256",key).update("team-results-v1\0").update(JSON.stringify(value)).digest("hex");}
const memberDetails = {
  participationId: true,
  participation: { select: {
    revision: true, fullName: true, courseLabel: true, universityName: true,
    user: { select: {
      email: true, emailVerified: true, role: true,
      preparedExternalAccount: { select: { login: true, confirmedAt: true } },
      legacyNsuhwClaim: { select: { login: true } },
    } },
  } },
} as const;

type Member = Prisma.TeamMemberGetPayload<{ select: typeof memberDetails }>;
function memberLogins({ participation: { user } }: Member) {
  if (!user.emailVerified || user.role !== "STUDENT" || !user.email.endsWith("@example.test")) return [];
  return [...new Set([
    ...(user.preparedExternalAccount?.confirmedAt ? [user.preparedExternalAccount.login] : []),
    ...(user.legacyNsuhwClaim ? [user.legacyNsuhwClaim.login] : []),
  ])];
}

async function inspect(tx: Prisma.TransactionClient, input: z.infer<typeof source>) {
  const parsed = parseResultCsv(input.csv, "team");
  const tasks = await tx.editionProblem.count({ where: { editionId: input.editionId } });
  if (tasks && tasks !== parsed.taskCount) throw new OlympiadError("CONFLICT", "Число задач не совпадает с задачами этого года");

  const ids = new Set<string>(), names = new Set<string>();
  for (const row of parsed.rows) {
    if (row.error) continue;
    if (row.teamName) names.add(row.teamName);
    else if (z.uuid().safeParse(row.login).success) ids.add(row.login.toLowerCase());
  }
  const teams = await tx.team.findMany({ where: { editionId: input.editionId, OR: [{ id: { in: [...ids] } }, { name: { in: [...names] } }] },
    select: { id: true, name: true, members: { orderBy: { participationId: "asc" }, select: memberDetails } },
  });
  const byId = new Map(teams.map(team => [team.id, team]));
  const byName = new Map<string, typeof teams>();
  for (const team of teams) byName.set(team.name, [...(byName.get(team.name) ?? []), team]);
  const existing = new Set((await tx.resultDocument.findMany({ where: { editionId: input.editionId, kind: input.kind, teamKey: { in: [...byId.keys()] } },
    select: { teamKey: true } })).map(row => row.teamKey));

  const counts = new Map<string, number>();
  const resolved = parsed.rows.map(row => {
    let team;
    if (row.memberLogins && row.teamName && !row.error) {
      const logins = new Set(row.memberLogins);
      const candidates = (byName.get(row.teamName) ?? []).filter(candidate => {
        if (candidate.members.length !== logins.size) return false;
        const matches = candidate.members.map(member => memberLogins(member).filter(login => logins.has(login)));
        return matches.every(match => match.length === 1) && new Set(matches.flat()).size === logins.size;
      });
      if (candidates.length === 1) team = candidates[0];
    } else if (!row.memberLogins) team = byId.get(row.login.toLowerCase());
    if (team) counts.set(team.id, (counts.get(team.id) ?? 0) + 1);
    return { row, team };
  });
  const rows = resolved.map(({ row, team }) => {
    const error = row.error ?? (!row.memberLogins && !z.uuid().safeParse(row.login).success ? "INVALID_TEAM_ID"
      : team && (counts.get(team.id) ?? 0) > 1 ? "DUPLICATE"
      : !team?.members.length ? "TEAM_UNAVAILABLE" : existing.has(team.id) ? "ALREADY_EXISTS" : null);
    return { ...row, error, teamId: team?.id ?? null, teamName: team?.name ?? row.teamName,
      members: team?.members.map(({ participationId, participation }) => ({ participationId, revision: participation.revision,
        fullName: participation.fullName, courseLabel: participation.courseLabel, universityName: participation.universityName })) ?? [] };
  });
  return { taskCount: parsed.taskCount, rows, validCount: rows.filter(row => !row.error).length,
    rejectedCount: rows.filter(row => !!row.error).length, selectionHash: fingerprint({ input, rows }) };
}

export async function teamResultRoster(db: PrismaClient, actorId: string, raw: unknown) {
  const input = scope.extend({ page: z.int().min(1).max(10000).default(1) }).strict().parse(raw);
  return db.$transaction(async tx => {
    await resultChief(tx, actorId, input.editionId);
    const where = { editionId: input.editionId };
    const total = await tx.team.count({ where });
    const teams = await tx.team.findMany({ where, orderBy: { id: "asc" }, skip: (input.page - 1) * 25, take: 25,
      select: { id: true, name: true, members: { orderBy: { participationId: "asc" }, select: memberDetails } },
    });
    return { total, page: input.page, teams: teams.map(team => ({ id: team.id, name: team.name,
      members: team.members.map(member => ({ participation: { fullName: member.participation.fullName,
        courseLabel: member.participation.courseLabel, universityName: member.participation.universityName },
        login: memberLogins(member)[0] ?? null })),
    })) };
  }, { isolationLevel: "RepeatableRead" });
}
export async function previewTeamResults(db:PrismaClient,actorId:string,raw:unknown){
 const input=source.parse(raw);return db.$transaction(async tx=>{await resultChief(tx,actorId,input.editionId);return inspect(tx,input);},{isolationLevel:"RepeatableRead",timeout:30000});
}
export async function applyTeamResults(db:PrismaClient,actorId:string,raw:unknown){
 const input=source.extend({id:z.uuid(),selectionHash:z.string().regex(/^[a-f0-9]{64}$/),password:z.string().min(1).max(128),confirmed:z.literal(true)}).strict().parse(raw);
 await resultChief(db,actorId,input.editionId);await reauthenticateParticipationChief(db,actorId,input.password);
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "OlympiadEdition" WHERE "id"=${input.editionId}::uuid FOR UPDATE`;
  await resultChief(tx,actorId,input.editionId);
  const original={editionId:input.editionId,kind:input.kind,csv:input.csv};const sourceHash=fingerprint(original);
  const old=await tx.teamResultImport.findUnique({where:{id:input.id}});
  if(old){if(old.editionId!==input.editionId||old.actorId!==actorId||old.kind!==input.kind||old.sourceHash!==sourceHash)throw new OlympiadError("CONFLICT","Идентификатор импорта уже использован");return {id:old.id,importedCount:old.importedCount,rejectedCount:old.rejectedCount};}
  const preview=await inspect(tx,original);
  if(preview.selectionHash!==input.selectionHash)throw new OlympiadError("CONFLICT","Состав команды или результаты изменились. Повторите предпросмотр.");
  if(!preview.validCount)throw new OlympiadError("CONFLICT","Нет верных строк");
  await tx.teamResultImport.create({data:{id:input.id,editionId:input.editionId,actorId,kind:input.kind,sourceHash,importedCount:preview.validCount,rejectedCount:preview.rejectedCount,report:preview.rows.map(r=>({line:r.line,error:r.error}))}});
  if(!await tx.editionProblem.count({where:{editionId:input.editionId}}))await tx.editionProblem.createMany({data:Array.from({length:preview.taskCount},(_,i)=>({editionId:input.editionId,ordinal:i+1}))});
  const ready=preview.rows.filter(r=>!r.error).map(row=>({row,id:randomUUID(),versionId:randomUUID()}));
  for(let at=0;at<ready.length;at+=100){
   const chunk=ready.slice(at,at+100);
   await tx.resultDocument.createMany({data:chunk.map(({row,id})=>({id,editionId:input.editionId,kind:input.kind,teamKey:row.teamId!,teamName:row.teamName!,teamBatchId:input.id}))});
   await tx.resultVersion.createMany({data:chunk.map(({row,id,versionId})=>({id:versionId,documentId:id,editionId:input.editionId,actorId,number:1,scores:row.scores,total:row.total,prize:row.prize}))});
   await tx.resultRecipient.createMany({data:chunk.flatMap(({row,id})=>row.members.map(m=>({documentId:id,editionId:input.editionId,participationId:m.participationId,fullName:m.fullName,courseLabel:m.courseLabel,universityName:m.universityName})))});
  }
  await tx.auditEvent.create({data:{actorId,editionId:input.editionId,action:"TEAM_RESULTS_IMPORTED",objectType:"TeamResultImport",objectId:input.id,outcome:"SUCCESS",details:{importedCount:preview.validCount,rejectedCount:preview.rejectedCount}}});
  return {id:input.id,importedCount:preview.validCount,rejectedCount:preview.rejectedCount};
 },{timeout:30000});
}
