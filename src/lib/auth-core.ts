import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP, twoFactor } from "better-auth/plugins";
import { createAuthMiddleware, APIError } from "better-auth/api";
import type { PrismaClient, Prisma } from "@prisma/client";
import { registrationSchema, assertDemoRegistration } from "./registration-rules";

export type Mail = { to: string; subject: string; text: string };
export function createAuth(database: PrismaClient | Prisma.TransactionClient, send: (mail: Mail) => Promise<void>, transactional = true) {
  if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) throw new Error("Configure a random BETTER_AUTH_SECRET (at least 32 characters)");
  const baseURL = process.env.BETTER_AUTH_URL || "http://localhost:3000";
  return betterAuth({
    appName: "Сибирская математическая олимпиада",
    baseURL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: prismaAdapter(database, { provider: "postgresql", transaction: transactional }),
    logger: { disabled: true },
    trustedOrigins: [new URL(baseURL).origin],
    advanced: { ipAddress: { ipAddressHeaders: [] }, database: { generateId: () => randomUUID() } },
    user: { additionalFields: {
      role: { type: ["STUDENT", "CHIEF_ORGANIZER", "VENUE_ORGANIZER", "TECHNICAL_ADMIN"], required: false, defaultValue: "STUDENT", input: false },
    } },
    session: { expiresIn: 60 * 60 * 24, updateAge: 60 * 60, cookieCache: { enabled: false } },
    verification: { storeIdentifier: "hashed" },
    emailAndPassword: {
      enabled: true, requireEmailVerification: true, minPasswordLength: 12, maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => send({ to: user.email, subject: "Восстановление доступа к ЛК СМО", text: `Для смены пароля откройте ссылку: ${url}\nЕсли вы не запрашивали смену пароля, проигнорируйте письмо.` }),
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 30,
      customRules: { "/sign-in/email": { window: 60, max: 5 }, "/sign-up/email": { window: 60, max: 5 }, "/request-password-reset": { window: 60, max: 3 } } },
    plugins: [
      emailOTP({ otpLength: 6, expiresIn: 600, allowedAttempts: 5, storeOTP: "hashed",
        sendVerificationOnSignUp: true, overrideDefaultEmailVerification: true,
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== "email-verification") throw new Error("Unsupported OTP purpose");
          await send({ to: email, subject: "Подтверждение email в ЛК СМО", text: `Код подтверждения: ${otp}\nКод действует 10 минут. Никому не сообщайте его.` });
        },
      }),
      twoFactor({ issuer: "СМО", backupCodeOptions: { storeBackupCodes: "encrypted" } }),
    ],
    hooks: { before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/two-factor/enable" && ctx.body?.method && ctx.body.method !== "totp") throw new APIError("FORBIDDEN", { message: "Only authenticator-app TOTP is supported" });
      if (ctx.path.startsWith("/two-factor/") && ctx.body?.trustDevice === true) throw new APIError("FORBIDDEN", { message: "Remembered MFA devices are not enabled" });
      if (ctx.path === "/sign-up/email") {
        const parsed = registrationSchema.safeParse(ctx.body);
        if (!parsed.success) throw new APIError("BAD_REQUEST", { message: "Проверьте поля регистрации и учебное согласие" });
        assertDemoRegistration(parsed.data.email);
        const [university, course] = await Promise.all([
          database.university.findFirst({ where: { id: parsed.data.universityId, active: true } }),
          database.courseOption.findFirst({ where: { id: parsed.data.courseId, active: true } }),
        ]);
        if (!university || !course) throw new APIError("BAD_REQUEST", { message: "Выберите доступный вуз и курс" });
      }
    }) },
  });
}
