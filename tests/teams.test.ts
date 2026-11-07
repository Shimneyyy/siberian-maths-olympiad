import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { createTeam, teamsView } from "../src/lib/teams";
import { AccessDenied } from "../src/lib/access";
import { correctParticipation } from "../src/lib/corrections";
process.env.DEMO_REGISTRATION = "true";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
async function fixture() {
  return db.$transaction(async tx => {
    const uni = await tx.university.create({ data: { name: "Учебный вуз команды", abbreviation: "УВ" } });
    const otherUni = await tx.university.create({ data: { name: "Другой учебный вуз", abbreviation: "ДВ" } });
    const course = await tx.courseOption.create({ data: { label: "Учебный курс команды" } });
    const ends = new Date(Date.now() + 86400000), starts = new Date(Date.now() - 86400000);
    const edition = await tx.olympiadEdition.create({ data: { year: 6900, title: "Учебный командный выпуск", registrationOpensAt: starts, registrationClosesAt: ends } });
    const next = await tx.olympiadEdition.create({ data: { year: 6901, title: "Другой командный год", registrationOpensAt: starts, registrationClosesAt: ends } });
    const users = [], participations = [];
    for (let i=0;i<10;i++) {
      const university = i === 9 ? otherUni : uni;
      const user = await tx.user.create({ data: { name: `Учебный участник команды ${i}`, email: `${randomUUID()}@example.test`, emailVerified: true } }); users.push(user);
      const consent = await tx.consentRecord.create({ data: { userId: user.id, purpose: "synthetic-demo-only", textVersion: "demo", textHash: "a".repeat(64) } });
      await tx.studentProfile.create({ data: { userId: user.id, fullName: user.name, universityId: university.id, courseId: course.id } });
      participations.push(await tx.participation.create({ data: { userId: user.id, editionId: i === 8 ? next.id : edition.id, format: "REMOTE", remoteZone: "NSK", fullName: user.name, universityId: university.id, universityName: university.name, universityAbbreviation: university.abbreviation, courseId: course.id, courseLabel: course.label, consentId: consent.id } }));
    }
    const staff = await tx.user.create({ data: { name: "Учебный организатор команды", email: `${randomUUID()}@example.test`, emailVerified: true, role: "VENUE_ORGANIZER", twoFactorEnabled: true } });
    return { uni, otherUni, course, edition, next, users, participations, staff };
  }, { timeout: 15000 });
}
let f: Awaited<ReturnType<typeof fixture>>;
before(async () => { f = await fixture(); });
beforeEach(async () => {
  await db.rateLimit.deleteMany({ where: { key: { in: f.users.map(u => `team-invite:${u.id}`) } } });
  await db.team.deleteMany({ where: { editionId: { in: [f.edition.id, f.next.id] } } });
  await db.olympiadEdition.updateMany({ where: { id: { in: [f.edition.id, f.next.id] } }, data: { registrationManuallyClosed: false } });
});
after(async () => {
  if (f) {
    const editions = [f.edition.id, f.next.id], users = [...f.users.map(u => u.id), f.staff.id];
    await db.rateLimit.deleteMany({ where: { key: { in: users.map(id => `team-invite:${id}`) } } });
    await db.team.deleteMany({ where: { editionId: { in: editions } } });
    await db.participation.deleteMany({ where: { editionId: { in: editions } } });
    await db.auditEvent.deleteMany({ where: { OR: [{ editionId: { in: editions } }, { actorId: { in: users } }] } });
    await db.olympiadEdition.deleteMany({ where: { id: { in: editions } } });
    await db.studentProfile.deleteMany({ where: { userId: { in: users } } });
    await db.consentRecord.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.university.deleteMany({ where: { id: { in: [f.uni.id, f.otherUni.id] } } });
    await db.courseOption.delete({ where: { id: f.course.id } });
  }
  await db.$disconnect();
});
const input = () => ({ editionId: f.edition.id, coachName: "Учебный тренер" });
test("team names use stable university slots 1-3 and captain occupies one member place", async () => {
  for (let i=0;i<3;i++) await createTeam(db, f.users[i].id, input());
  const teams = await db.team.findMany({ where: { editionId: f.edition.id }, orderBy: { slot: "asc" }, include: { members: true } });
  assert.deepEqual(teams.map(t => t.name), ["УВ-1", "УВ-2", "УВ-3"]);
  assert.ok(teams.every(t => t.members.length === 1 && t.members[0].participationId === t.captainParticipationId));
  await assert.rejects(createTeam(db, f.users[3].id, input()), /трёх команд/);
  await assert.rejects(createTeam(db, f.users[0].id, input()), /уже состоите/);
});
test("teams are private to members, scoped to their annual university and blocked after manual closure", async () => {
  await createTeam(db, f.users[0].id, input());
  const mine = await teamsView(db, f.users[0].id);
  assert.equal(mine[0].team?.name, "УВ-1");
  assert.equal(mine[0].team?.members[0].fullName, f.users[0].name);
  const stranger = await teamsView(db, f.users[1].id); assert.equal(stranger[0].team, null);
  await assert.rejects(teamsView(db, f.staff.id), AccessDenied);
  await assert.rejects(createTeam(db, f.staff.id, input()), AccessDenied);
  await assert.rejects(createTeam(db, f.users[8].id, input()), AccessDenied);
  await assert.rejects(createTeam(db, f.users[1].id, { ...input(), captainId: f.users[0].id }));
  await assert.rejects(correctParticipation(db, f.users[0].id, { editionId: f.edition.id, participationId: f.participations[0].id, revision: 0, fullName: f.users[0].name, universityId: f.otherUni.id, courseId: f.course.id }), /Сначала выйдите/);
  await db.olympiadEdition.update({ where: { id: f.edition.id }, data: { registrationManuallyClosed: true } });
  await assert.rejects(createTeam(db, f.users[1].id, input()), AccessDenied);
  assert.equal((await teamsView(db, f.users[0].id))[0].team?.name, "УВ-1", "Closed years retain team history");
});

test("exact-email invitations require recipient confirmation and do not reveal unrelated accounts", async () => {
  const { teamAction } = await import("../src/lib/team-actions");
  const team = await createTeam(db, f.users[0].id, input());
  const invite = (email: string) => teamAction(db, f.users[0].id, { operation: "invite", editionId: f.edition.id, teamId: team.id, email });
  await invite(f.users[1].email);
  for (const email of [f.users[8].email, f.users[9].email, `missing-${randomUUID()}@example.test`]) assert.deepEqual(await invite(email), { status: "ok" });
  assert.equal(await db.teamInvitation.count({ where: { teamId: team.id } }), 1);
  const incoming = (await teamsView(db, f.users[1].id))[0].invitations[0];
  assert.equal(incoming.teamName, "УВ-1");
  const accept = { editionId: f.edition.id, operation: "acceptInvitation", invitationId: incoming.id, revision: incoming.revision };
  await assert.rejects(teamAction(db, f.users[2].id, accept), AccessDenied);
  await assert.rejects(teamAction(db, f.users[1].id, { ...accept, actorId: f.users[0].id }));
  await teamAction(db, f.users[1].id, accept);
  await assert.rejects(teamAction(db, f.users[1].id, accept), /Приглашение уже изменено/);
  const member = (await teamsView(db, f.users[1].id))[0].team!;
  assert.equal(member.members.length, 2); assert.equal(member.invitations.length, 0);
  await assert.rejects(teamAction(db, f.users[1].id, { operation: "invite", editionId: f.edition.id, teamId: team.id, email: f.users[2].email }), AccessDenied);
});

test("captain transfer requires target confirmation; departure/exclusion and revocation update current rights", async () => {
  const { teamAction } = await import("../src/lib/team-actions");
  const team = await createTeam(db, f.users[0].id, input());
  await teamAction(db, f.users[0].id, { operation: "invite", editionId: f.edition.id, teamId: team.id, email: f.users[1].email });
  const invitation = (await teamsView(db, f.users[1].id))[0].invitations[0];
  await teamAction(db, f.users[1].id, { operation: "acceptInvitation", editionId: f.edition.id, invitationId: invitation.id, revision: invitation.revision });
  await teamAction(db, f.users[0].id, { operation: "requestCaptain", editionId: f.edition.id, teamId: team.id, participationId: f.participations[1].id });
  assert.equal((await db.team.findUniqueOrThrow({ where: { id: team.id } })).captainParticipationId, f.participations[0].id);
  const transfer = (await teamsView(db, f.users[1].id))[0].team!.transfer!;
  const accept = { operation: "acceptCaptain", editionId: f.edition.id, teamId: team.id, revision: transfer.revision };
  await assert.rejects(teamAction(db, f.users[0].id, accept), AccessDenied);
  await teamAction(db, f.users[1].id, accept);
  assert.equal((await db.team.findUniqueOrThrow({ where: { id: team.id } })).captainParticipationId, f.participations[1].id);
  await assert.rejects(teamAction(db, f.users[0].id, { operation: "exclude", editionId: f.edition.id, teamId: team.id, participationId: f.participations[1].id }), AccessDenied);
  await teamAction(db, f.users[0].id, { operation: "leave", editionId: f.edition.id, teamId: team.id });
  assert.equal(await db.teamMember.findUnique({ where: { participationId: f.participations[0].id } }), null);
  await assert.rejects(teamAction(db, f.users[1].id, { operation: "leave", editionId: f.edition.id, teamId: team.id }), /Капитан сначала/);
  await teamAction(db, f.users[1].id, { operation: "invite", editionId: f.edition.id, teamId: team.id, email: f.users[2].email });
  const outgoing = (await teamsView(db, f.users[1].id))[0].team!.invitations[0];
  await teamAction(db, f.users[1].id, { operation: "revokeInvitation", editionId: f.edition.id, teamId: team.id, invitationId: outgoing.id, revision: outgoing.revision });
  await assert.rejects(teamAction(db, f.users[2].id, { operation: "acceptInvitation", editionId: f.edition.id, invitationId: outgoing.id, revision: outgoing.revision }), /Приглашение уже изменено/);
});

test("closed editions freeze pending invitation decisions and teams cannot cross university/year boundaries", async () => {
  const { teamAction } = await import("../src/lib/team-actions");
  const team = await createTeam(db, f.users[0].id, input());
  await teamAction(db, f.users[0].id, { operation: "invite", editionId: f.edition.id, teamId: team.id, email: f.users[1].email });
  const invitation = (await teamsView(db, f.users[1].id))[0].invitations[0];
  await db.olympiadEdition.update({ where: { id: f.edition.id }, data: { registrationManuallyClosed: true } });
  await assert.rejects(teamAction(db, f.users[1].id, { operation: "acceptInvitation", editionId: f.edition.id, invitationId: invitation.id, revision: invitation.revision }), AccessDenied);
  assert.equal((await teamsView(db, f.users[0].id))[0].canChange, false);
  const audit = await db.auditEvent.findMany({ where: { objectId: team.id } });
  assert.ok(!JSON.stringify(audit).includes(f.users[1].email));
});
