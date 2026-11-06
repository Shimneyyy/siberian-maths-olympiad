import { z } from "zod";
export class OlympiadError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "REGISTRATION_CLOSED" | "INVALID_VENUE" | "PROFILE_REQUIRED" | "CONSENT_REQUIRED" | "ALREADY_REGISTERED" | "CONFLICT", message: string) { super(message); }
}
export type Window = { registrationOpensAt: Date | null; registrationClosesAt: Date | null; registrationManuallyClosed: boolean };
export function registrationState(edition: Window, now: Date) {
  if (edition.registrationManuallyClosed) return "MANUALLY_CLOSED" as const;
  if (!edition.registrationOpensAt || !edition.registrationClosesAt) return "UNCONFIGURED" as const;
  if (now < edition.registrationOpensAt) return "UPCOMING" as const;
  if (now >= edition.registrationClosesAt) return "CLOSED" as const;
  return "OPEN" as const;
}
const date = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
export const editionSettingsSchema = z.object({
  editionId: z.uuid(), revision: z.int().nonnegative(), title: z.string().trim().min(1).max(200),
  registrationOpensAt: date, registrationClosesAt: date, registrationManuallyClosed: z.boolean(), isCurrent: z.boolean(),
}).refine((x) => x.registrationOpensAt < x.registrationClosesAt, "Начало должно быть раньше окончания");
const venueFields = {
  editionId: z.uuid(), label: z.string().trim().min(1).max(200), address: z.string().trim().min(1).max(500),
  room: z.string().trim().max(200).default(""), instructions: z.string().trim().max(4000).default(""),
};
export const createVenueSchema = z.object({ ...venueFields, venueId: z.uuid().optional() });
export const updateVenueSchema = z.object({ ...venueFields, editionVenueId: z.uuid(), revision: z.int().nonnegative(), active: z.boolean() });
const profileFields = { fullName: z.string().trim().min(3).max(200), universityId: z.uuid(), courseId: z.uuid() };
export const participationSchema = z.discriminatedUnion("format", [
  z.object({ editionId: z.uuid(), format: z.literal("ONSITE"), editionVenueId: z.uuid(), ...profileFields }).strict(),
  z.object({ editionId: z.uuid(), format: z.literal("REMOTE"), remoteZone: z.enum(["MSK", "NSK"]), ...profileFields }).strict(),
]);
