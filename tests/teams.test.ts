import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";
import { hashPassword } from "better-auth/crypto";
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
    const staff = await tx.user.create({ data: { name: "Учебный организатор команды", email: `${randomUUID()}@example.test`, emailVerified: true, role: "VENUE_ORGANIZER" } });
    const chief = await tx.user.create({ data: { name: "Учебный главный отмены", email: `${randomUUID()}@example.test`, emailVerified: true, role: "CHIEF_ORGANIZER" } });
    await tx.account.create({ data: { userId: chief.id, accountId: chief.id, providerId: "credential", password: await hashPassword("Synthetic-cancellation-password") } });
    await tx.editionStaffGrant.create({ data: { userId: chief.id, editionId: edition.id } });
    return { uni, otherUni, course, edition, next, users, participations, staff, chief };
  }, { timeout: 15000 });
}
let f: Awaited<ReturnType<typeof fixture>>;
before(async () => { f = await fixture(); });
beforeEach(async () => {
  await db.rateLimit.deleteMany({ where: { key: { in: f.users.map(u => `team-invite:${u.id}`) } } });
  await db.team.deleteMany({ where: { editionId: { in: [f.edition.id, f.next.id] } } });
  await db.participation.updateMany({ where: { editionId: { in: [f.edition.id, f.next.id] } }, data: { status: "REGISTERED", revision: 0 } });
  await db.olympiadEdition.updateMany({ where: { id: { in: [f.edition.id, f.next.id] } }, data: { registrationManuallyClosed: false } });
});
after(async () => {
  if (f) {
    const editions = [f.edition.id, f.next.id], users = [...f.users.map(u => u.id), f.staff.id, f.chief.id];
    await db.rateLimit.deleteMany({ where: { key: { in: users.flatMap(id => [`team-invite:${id}`, `correction-reauth:${id}`]) } } });
    await db.team.deleteMany({ where: { editionId: { in: editions } } });
    await db.participation.deleteMany({ where: { editionId: { in: editions } } });
    await db.auditEvent.deleteMany({ where: { OR: [{ editionId: { in: editions } }, { actorId: { in: users } }] } });
    await db.editionStaffGrant.deleteMany({ where: { editionId: { in: editions } } });
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

test("concurrent team creation cannot produce a fourth university team or duplicate captain membership", async () => {
  const results = await Promise.allSettled(f.users.slice(0,4).map(u => createTeam(db, u.id, input())));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 3);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
  assert.equal(await db.team.count({ where: { editionId: f.edition.id } }), 3);
  await db.team.deleteMany({ where: { editionId: f.edition.id } });
  const repeated = await Promise.allSettled([createTeam(db, f.users[0].id, input()), createTeam(db, f.users[0].id, input())]);
  assert.equal(repeated.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(await db.teamMember.count({ where: { participationId: f.participations[0].id } }), 1);
});

test("parallel invitation acceptance cannot create a sixth member or join two teams", async () => {
  const { teamAction } = await import("../src/lib/team-actions");
  const team = await createTeam(db, f.users[0].id, input());
  for (const user of f.users.slice(1,7)) await teamAction(db, f.users[0].id, { operation: "invite", editionId: f.edition.id, teamId: team.id, email: user.email });
  const results = await Promise.allSettled(f.users.slice(1,7).map(async user => {
    const invitation = (await teamsView(db, user.id))[0].invitations[0];
    return teamAction(db, user.id, { operation: "acceptInvitation", editionId: f.edition.id, invitationId: invitation.id, revision: invitation.revision });
  }));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 4);
  assert.equal(await db.teamMember.count({ where: { teamId: team.id } }), 5);
  await assert.rejects(db.teamMember.create({ data: { participationId: f.participations[7].id, teamId: team.id, editionId: f.edition.id, universityId: f.uni.id } }), "SQL trigger also rejects a raw sixth insertion");
  await db.team.deleteMany({ where: { editionId: f.edition.id } });
  const first = await createTeam(db, f.users[0].id, input()), second = await createTeam(db, f.users[1].id, input());
  for (const [captain, t] of [[f.users[0],first], [f.users[1],second]] as const) await teamAction(db, captain.id, { operation: "invite", editionId: f.edition.id, teamId: t.id, email: f.users[2].email });
  const invitations = (await teamsView(db, f.users[2].id))[0].invitations;
  const competing = await Promise.allSettled(invitations.map(i => teamAction(db, f.users[2].id, { operation: "acceptInvitation", editionId: f.edition.id, invitationId: i.id, revision: i.revision })));
  assert.equal(competing.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(await db.teamMember.count({ where: { participationId: f.participations[2].id } }), 1);
});

test("SQL rejects foreign year/university membership and invitations and fourth slot even without the service", async () => {
  const team = await createTeam(db, f.users[0].id, input());
  for (const participant of [f.participations[8], f.participations[9]]) {
    await assert.rejects(db.teamMember.create({ data: { teamId: team.id, participationId: participant.id, editionId: f.edition.id, universityId: f.uni.id } }));
  }
  await assert.rejects(db.teamInvitation.create({ data: { teamId: team.id, editionId: f.edition.id, targetParticipationId: f.participations[8].id } }));
  await assert.rejects(db.captainTransfer.create({ data: { teamId: team.id, editionId: f.edition.id, universityId: f.uni.id, targetParticipationId: f.participations[9].id } }));
  await assert.rejects(db.team.create({ data: { editionId: f.edition.id, universityId: f.uni.id, captainParticipationId: f.participations[1].id, slot: 4, name: "Недопустимая команда", coachName: "Учебный тренер" } }));
});

test("cancellation frees membership, preserves annual history and cannot be restored by registration POST", async () => {
  const { teamAction } = await import("../src/lib/team-actions");
  const { cancelParticipation } = await import("../src/lib/cancellation");
  const { registerParticipation } = await import("../src/lib/olympiad");
  const team = await createTeam(db, f.users[0].id, input());
  await teamAction(db, f.users[0].id, { operation: "invite", editionId: f.edition.id, teamId: team.id, email: f.users[1].email });
  const invite = (await teamsView(db, f.users[1].id))[0].invitations[0];
  await teamAction(db, f.users[1].id, { operation: "acceptInvitation", editionId: f.edition.id, invitationId: invite.id, revision: invite.revision });
  const data = { editionId: f.edition.id, participationId: f.participations[1].id, revision: 0, confirmed: true };
  await assert.rejects(cancelParticipation(db, f.users[2].id, data), AccessDenied);
  await assert.rejects(cancelParticipation(db, f.staff.id, data), AccessDenied);
  await assert.rejects(cancelParticipation(db, f.users[1].id, { ...data, userId: f.users[0].id }));
  await assert.rejects(cancelParticipation(db, f.users[1].id, { ...data, confirmed: false }));
  await cancelParticipation(db, f.users[1].id, data);
  const p = await db.participation.findUniqueOrThrow({ where: { id: data.participationId } });
  assert.equal(p.status, "CANCELLED"); assert.equal(p.fullName, f.participations[1].fullName); assert.equal(p.revision, 1);
  assert.equal(await db.teamMember.count({ where: { teamId: team.id } }), 1);
  assert.equal(await db.user.count({ where: { id: f.users[1].id } }), 1);
  await assert.rejects(cancelParticipation(db, f.users[1].id, data), /Восстановление недоступно/);
  await assert.rejects(registerParticipation(db, f.users[1].id, { editionId: f.edition.id, format: "REMOTE", remoteZone: "NSK", fullName: f.users[1].name, universityId: f.uni.id, courseId: f.course.id }), /Повторный запрос не меняет/);
});

test("captain cancellation atomically dissolves only that team and leaves the other registrations active", async () => {
  const { teamAction } = await import("../src/lib/team-actions");
  const { cancelParticipation } = await import("../src/lib/cancellation");
  const team = await createTeam(db, f.users[0].id, input()), other = await createTeam(db, f.users[2].id, input());
  await teamAction(db, f.users[0].id, { operation: "invite", editionId: f.edition.id, teamId: team.id, email: f.users[1].email });
  const invitation = (await teamsView(db, f.users[1].id))[0].invitations[0];
  await teamAction(db, f.users[1].id, { operation: "acceptInvitation", editionId: f.edition.id, invitationId: invitation.id, revision: invitation.revision });
  await cancelParticipation(db, f.users[0].id, { editionId: f.edition.id, participationId: f.participations[0].id, revision: 0, confirmed: true });
  assert.equal(await db.team.findUnique({ where: { id: team.id } }), null);
  assert.equal(await db.teamMember.count({ where: { teamId: team.id } }), 0);
  assert.equal((await db.participation.findUniqueOrThrow({ where: { id: f.participations[1].id } })).status, "REGISTERED");
  assert.ok(await db.team.findUnique({ where: { id: other.id } }));
  await createTeam(db, f.users[1].id, input());
  const audit = await db.auditEvent.findFirstOrThrow({ where: { objectId: team.id, action: "TEAM_DISSOLVED_CAPTAIN_CANCELLED" } });
  assert.ok(!JSON.stringify(audit).includes(f.users[1].name));
});

test("manual closure blocks student cancellation; assigned chief cannot cancel after closure", async () => {
  const { cancelParticipation } = await import("../src/lib/cancellation");
  const data = { editionId: f.edition.id, participationId: f.participations[0].id, revision: 0, confirmed: true };
  const chief = { ...data, reason: "Учебная причина отмены", password: "Synthetic-cancellation-password" };
  await assert.rejects(cancelParticipation(db, f.chief.id, chief), AccessDenied);
  await db.olympiadEdition.update({ where: { id: f.edition.id }, data: { registrationManuallyClosed: true } });
  await assert.rejects(cancelParticipation(db, f.users[0].id, data), AccessDenied);
  await assert.rejects(cancelParticipation(db, f.chief.id, data), AccessDenied);
  await assert.rejects(cancelParticipation(db, f.chief.id, { ...chief, password: "wrong" }), AccessDenied);
  await db.user.update({ where: { id: f.chief.id }, data: { emailVerified: false } });
  try { await assert.rejects(cancelParticipation(db, f.chief.id, chief), AccessDenied); }
  finally { await db.user.update({ where: { id: f.chief.id }, data: { emailVerified: true } }); }
  await assert.rejects(cancelParticipation(db, f.chief.id, chief), AccessDenied);
  assert.equal((await db.participation.findUniqueOrThrow({ where: { id: data.participationId } })).status, "REGISTERED");
});

test("captain can receive another team's invitation, dissolve own team and join without cancelling participation", async () => {
  const { teamAction } = await import("../src/lib/team-actions");
  const own = await createTeam(db, f.users[0].id, input());
  const other = await createTeam(db, f.users[2].id, input());
  const act = (actor: number, command: Record<string, unknown>) => teamAction(db, f.users[actor].id, { editionId: f.edition.id, ...command });
  await act(0, { operation: "invite", teamId: own.id, email: f.users[1].email });
  const teammateInvite = (await teamsView(db, f.users[1].id))[0].invitations[0];
  await act(1, { operation: "acceptInvitation", invitationId: teammateInvite.id, revision: teammateInvite.revision });
  await act(0, { operation: "requestCaptain", teamId: own.id, participationId: f.participations[1].id });
  await act(2, { operation: "invite", teamId: other.id, email: f.users[0].email });
  const incoming = (await teamsView(db, f.users[0].id))[0].invitations[0];
  assert.equal(incoming.teamName, "УВ-2", "A captain must receive incoming invitations");
  await assert.rejects(act(0, { operation: "acceptInvitation", invitationId: incoming.id, revision: incoming.revision }), /уже состоите/);
  await assert.rejects(act(1, { operation: "delete", teamId: own.id, confirmed: true }), AccessDenied);
  await assert.rejects(act(0, { operation: "delete", teamId: own.id, confirmed: false }));
  const snapshots = await db.participation.findMany({ where: { id: { in: f.participations.slice(0, 3).map(p => p.id) } }, orderBy: { id: "asc" } });
  await act(0, { operation: "delete", teamId: own.id, confirmed: true });
  assert.equal(await db.team.count({ where: { id: own.id } }), 0);
  assert.equal(await db.teamMember.count({ where: { teamId: own.id } }), 0);
  assert.equal(await db.teamInvitation.count({ where: { teamId: own.id } }), 0);
  assert.equal(await db.captainTransfer.count({ where: { teamId: own.id } }), 0);
  assert.deepEqual(await db.participation.findMany({ where: { id: { in: snapshots.map(p => p.id) } }, orderBy: { id: "asc" } }), snapshots);
  await act(0, { operation: "acceptInvitation", invitationId: incoming.id, revision: incoming.revision });
  assert.equal((await teamsView(db, f.users[0].id))[0].team?.id, other.id);
  assert.equal(await db.auditEvent.count({ where: { action: "TEAM_DELETED", objectId: own.id } }), 1);
});

test("team deletion respects current captain, year closure and serializes against acceptance", async () => {
  const { teamAction } = await import("../src/lib/team-actions");
  const own = await createTeam(db, f.users[0].id, input());
  const command = { editionId: f.edition.id, teamId: own.id, operation: "delete", confirmed: true };
  await assert.rejects(teamAction(db, f.users[8].id, command), AccessDenied);
  await db.olympiadEdition.update({ where: { id: f.edition.id }, data: { registrationManuallyClosed: true } });
  await assert.rejects(teamAction(db, f.users[0].id, command), AccessDenied);
  await db.olympiadEdition.update({ where: { id: f.edition.id }, data: { registrationManuallyClosed: false } });
  await teamAction(db, f.users[0].id, { editionId: f.edition.id, teamId: own.id, operation: "invite", email: f.users[1].email });
  const invite = (await teamsView(db, f.users[1].id))[0].invitations[0];
  await Promise.allSettled([
    teamAction(db, f.users[0].id, command),
    teamAction(db, f.users[1].id, { editionId: f.edition.id, operation: "acceptInvitation", invitationId: invite.id, revision: invite.revision }),
  ]);
  assert.equal(await db.team.count({ where: { id: own.id } }), 0);
  assert.equal(await db.teamMember.count({ where: { teamId: own.id } }), 0);
  assert.equal((await db.participation.findUniqueOrThrow({ where: { id: f.participations[1].id } })).status, "REGISTERED");
});
