import { APIError } from "better-auth/api";
import { z } from "zod";
import { latinLoginPart, nsuhwLoginNamesSchema } from "./nsuhw-login-name-rules";
import { legacyNsuhwLogin } from "./legacy-nsuhw-rules";
export const DEMO_CONSENT_VERSION = "demo-only-v1";
export const DEMO_CONSENT_TEXT = "Учебная заглушка: использую только вымышленные данные. Это не согласие на обработку реальных персональных данных.";
export const registrationSchema = z.object({
  name: z.string().trim().min(3).max(200),
  email: z.email().max(254).transform((s) => s.trim().toLowerCase()),
  password: z.string().min(12).max(128),
  universityId: z.uuid(), courseId: z.uuid(), demoConsent: z.literal(true),
  firstNameLatin: latinLoginPart.optional(), lastNameLatin: latinLoginPart.optional(),
  legacyNsuhwLogin: legacyNsuhwLogin.optional(),
}).superRefine((value,ctx) => {
  if (value.legacyNsuhwLogin) {
    if (value.firstNameLatin !== undefined || value.lastNameLatin !== undefined) ctx.addIssue({code:"custom",message:"Для старого аккаунта новые данные логина не собираются"});
  } else if (!nsuhwLoginNamesSchema.safeParse({firstNameLatin:value.firstNameLatin,lastNameLatin:value.lastNameLatin}).success) ctx.addIssue({code:"custom",message:"Укажите имя и фамилию латиницей для нового логина"});
});
export function assertDemoRegistration(email: string) {
  // Legal documents are not approved: no switch for production collection yet.
  if (process.env.DEMO_REGISTRATION !== "true" || process.env.NODE_ENV === "production" || !email.endsWith("@example.test")) {
    throw new APIError("FORBIDDEN", { message: "Доступна только учебная регистрация с вымышленными данными и email @example.test" });
  }
}
