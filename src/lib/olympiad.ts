import type { PrismaClient, Prisma } from "@prisma/client";
import { assertDemoRegistration } from "./registration-rules";
import { AccessDenied, authorizeStaff } from "./access";
import { createVenueSchema, editionSettingsSchema, updateVenueSchema, participationSchema, registrationState, OlympiadError } from "./olympiad-rules";

type Tx = Prisma.TransactionClient;
function scheduleMetadata(value: { registrationOpensAt: Date | null; registrationClosesAt: Date | null; registrationManuallyClosed: boolean; isCurrent: boolean; revision: number }) {
  return { opensAt: value.registrationOpensAt?.toISOString() ?? null, closesAt: value.registrationClosesAt?.toISOString() ?? null,
    manuallyClosed: value.registrationManuallyClosed, isCurrent: value.isCurrent, revision: value.revision };
}
async function lockEdition(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "OlympiadEdition" WHERE "id" = ${id}::uuid FOR UPDATE`;
  if (!rows.length) throw new OlympiadError("NOT_FOUND", "Выпуск не найден");
}
export async function saveEdition(db: PrismaClient, actorId: string, raw: unknown) {
  const input = editionSettingsSchema.parse(raw);
  return db.$transaction(async (tx) => {
    // Same order for every settings change; protects both switching and edition revisions.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(4726, 1)`;
    await lockEdition(tx, input.editionId);
    await authorizeStaff(tx, actorId, "edition:manage", input.editionId);
    const old = await tx.olympiadEdition.findUniqueOrThrow({ where: { id: input.editionId } });
    // Legacy settings endpoint must never change the registration window, even directly.
    if ((old.registrationOpensAt?.getTime() ?? null) !== (input.registrationOpensAt?.getTime() ?? null) ||
        (old.registrationClosesAt?.getTime() ?? null) !== (input.registrationClosesAt?.getTime() ?? null) ||
        old.registrationManuallyClosed !== input.registrationManuallyClosed) throw new AccessDenied("FORBIDDEN");
    if (old.revision !== input.revision) throw new OlympiadError("CONFLICT", "Настройки уже изменены. Обновите страницу.");
    if (old.isCurrent && !input.isCurrent) throw new OlympiadError("CONFLICT", "Чтобы сменить текущий выпуск, назначьте текущим другой год.");
    if (input.isCurrent) {
      const previous = await tx.olympiadEdition.findFirst({ where: { isCurrent: true, id: { not: input.editionId } } });
      if (previous) {
        await authorizeStaff(tx, actorId, "edition:manage", previous.id);
        await tx.olympiadEdition.update({ where: { id: previous.id }, data: { isCurrent: false, revision: { increment: 1 } } });
        await tx.auditEvent.create({ data: { actorId, action: "EDITION_CURRENT_UNSET", objectType: "OlympiadEdition", objectId: previous.id, editionId: previous.id, outcome: "SUCCESS" } });
      }
    }
    const { editionId, ...data } = input;
    const result = await tx.olympiadEdition.update({ where: { id: editionId }, data: { ...data, revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "EDITION_SETTINGS_UPDATED", objectType: "OlympiadEdition", objectId: editionId, editionId, outcome: "SUCCESS", details: { before: scheduleMetadata(old), after: scheduleMetadata(result) } } });
    return result;
  }, { timeout: 10000 });
}
export async function createEditionVenue(db: PrismaClient, actorId: string, raw: unknown) {
  const input = createVenueSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await lockEdition(tx, input.editionId);
    await authorizeStaff(tx, actorId, "venues:manage", input.editionId);
    let venueId = input.venueId;
    if (venueId) {
      const known = await tx.venue.findFirst({ where: { id: venueId, editions: { some: { edition: { staffGrants: { some: { userId: actorId, revokedAt: null } } } } } } });
      if (!known) throw new AccessDenied("FORBIDDEN");
    } else {
      venueId = (await tx.venue.create({ data: { name: input.label } })).id;
    }
    const site = await tx.editionVenue.create({ data: { editionId: input.editionId, venueId, label: input.label, address: input.address, room: input.room, instructions: input.instructions } });
    await tx.auditEvent.create({ data: { actorId, action: "EDITION_VENUE_CREATED", objectType: "EditionVenue", objectId: site.id, editionId: input.editionId, outcome: "SUCCESS" } });
    return site;
  });
}
export async function saveEditionVenue(db: PrismaClient, actorId: string, raw: unknown) {
  const input = updateVenueSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await lockEdition(tx, input.editionId);
    await authorizeStaff(tx, actorId, "venues:manage", input.editionId, input.editionVenueId);
    const site = await tx.editionVenue.findUnique({ where: { id: input.editionVenueId } });
    if (!site || site.editionId !== input.editionId) throw new OlympiadError("NOT_FOUND", "Площадка не найдена");
    if (site.revision !== input.revision) throw new OlympiadError("CONFLICT", "Площадка уже изменена. Обновите страницу.");
    const { editionVenueId, editionId, ...data } = input;
    const result = await tx.editionVenue.update({ where: { id: editionVenueId }, data: { ...data, revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "EDITION_VENUE_UPDATED", objectType: "EditionVenue", objectId: editionVenueId, editionId, outcome: "SUCCESS", details: { previousRevision: site.revision, revision: result.revision, previouslyActive: site.active, active: result.active } } });
    return result;
  });
}
export async function registerParticipation(db: PrismaClient, actorId: string, raw: unknown, clock: () => Date = () => new Date()) {
  const input = participationSchema.parse(raw);
  return db.$transaction(async (tx) => {
    // Closing registration, disabling venues and concurrent signup share this lock.
    await lockEdition(tx, input.editionId);
    const actor = await tx.user.findUnique({ where: { id: actorId }, include: { profile: true } });
    if (!actor?.emailVerified || actor.role !== "STUDENT") throw new AccessDenied("FORBIDDEN");
    assertDemoRegistration(actor.email);
    const previous = await tx.participation.findUnique({ where: { userId_editionId: { userId: actorId, editionId: input.editionId } } });
    if (previous) {
      const identical = previous.status === "REGISTERED" && previous.format === input.format &&
        (input.format === "ONSITE" ? previous.editionVenueId === input.editionVenueId : previous.remoteZone === input.remoteZone) &&
        previous.fullName === input.fullName && previous.universityId === input.universityId && previous.courseId === input.courseId;
      if (!identical) throw new OlympiadError("ALREADY_REGISTERED", "Участие уже зарегистрировано. Повторный запрос не меняет площадку и сведения.");
      return previous;
    }
    const edition = await tx.olympiadEdition.findUniqueOrThrow({ where: { id: input.editionId } });
    if (registrationState(edition, clock()) !== "OPEN") throw new OlympiadError("REGISTRATION_CLOSED", "Регистрация на этот выпуск закрыта");
    if (!actor.profile) throw new OlympiadError("PROFILE_REQUIRED", "Необходимо заполнить профиль студента");
    const [university, course, consent] = await Promise.all([
      tx.university.findFirst({ where: { id: input.universityId, active: true } }),
      tx.courseOption.findFirst({ where: { id: input.courseId, active: true } }),
      tx.consentRecord.findFirst({ where: { userId: actorId, purpose: "synthetic-demo-only", withdrawnAt: null }, orderBy: { acceptedAt: "desc" } }),
    ]);
    if (!university || !course) throw new OlympiadError("PROFILE_REQUIRED", "Выберите доступный вуз и курс");
    if (!consent) throw new OlympiadError("CONSENT_REQUIRED", "Не найдена действующая учебная отметка");
    if (input.format === "ONSITE") {
      const site = await tx.editionVenue.findFirst({ where: { id: input.editionVenueId, editionId: input.editionId, active: true } });
      if (!site) throw new OlympiadError("INVALID_VENUE", "Выбранная площадка не принимает регистрации этого выпуска");
    }
    await tx.studentProfile.update({ where: { userId: actorId }, data: { fullName: input.fullName, universityId: university.id, courseId: course.id } });
    await tx.user.update({ where: { id: actorId }, data: { name: input.fullName } });
    const participation = await tx.participation.create({ data: {
      userId: actorId, editionId: input.editionId, format: input.format,
      editionVenueId: input.format === "ONSITE" ? input.editionVenueId : null,
      remoteZone: input.format === "REMOTE" ? input.remoteZone : null,
      fullName: input.fullName, universityId: university.id, universityName: university.name, universityAbbreviation: university.abbreviation,
      courseId: course.id, courseLabel: course.label, consentId: consent.id,
    } });
    await tx.auditEvent.create({ data: { actorId, action: "PARTICIPATION_REGISTERED", objectType: "Participation", objectId: participation.id, editionId: input.editionId, outcome: "SUCCESS" } });
    return participation;
  }, { timeout: 15000 });
}
