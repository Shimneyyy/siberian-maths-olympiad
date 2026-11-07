import nodemailer from "nodemailer";
import type { Mail } from "./auth-core";
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "127.0.0.1",
  port: Number(process.env.SMTP_PORT || 1025),
  secure: Number(process.env.SMTP_PORT || 1025) === 465,
  connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000,
  requireTLS: process.env.NODE_ENV === "production",
  ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } } : {}),
});
export async function sendMail(mail: Mail & { messageId?: string }) {
  return transport.sendMail({ from: process.env.SMTP_FROM || "СМО <no-reply@example.test>", ...mail });
}
