import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { AccessDenied } from "./access";
import { assertDemoRegistration } from "./registration-rules";
export async function personalHistory(db: PrismaClient, actorId: string, rawPage: unknown = 1) {
  const page = z.coerce.number().int().min(1).max(10000).parse(rawPage);
  return db.$transaction(async tx => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    if (user.role !== "STUDENT" || !user.emailVerified) throw new AccessDenied("FORBIDDEN");
    assertDemoRegistration(user.email);
    const where = { participation: { userId: actorId }, batch: { publication: { isNot: null } }, OR: [{ kind: "FINAL" as const }, { kind: "PRELIMINARY" as const, participation: { userId: actorId, individualResults: { none: { kind: "FINAL" as const, batch: { publication: { isNot: null } } } } } }] };
    const total = await tx.individualResult.count({ where });
    const rows = await tx.individualResult.findMany({ where, orderBy: [{ edition: { year: "desc" } }, { id: "asc" }], take: 25, skip: (page - 1) * 25, select: { id: true, kind: true, total: true, prize: true, edition: { select: { year: true } }, scores: { orderBy: { problem: { ordinal: "asc" } }, select: { score: true, problem: { select: { ordinal: true } } } } } });
    return { total, page, rows: rows.map(r => ({ id: r.id, year: r.edition.year, kind: r.kind, total: r.total, prize: r.prize, scores: r.scores.map(s => ({ ordinal: s.problem.ordinal, score: s.score })) })) };
  }, { isolationLevel: "RepeatableRead" });
}
