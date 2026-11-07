import "server-only";
import type { Mail } from "./auth-core";
import { sendMail as deliverMail } from "./mail-transport";
export async function sendMail(mail: Mail) { await deliverMail(mail); }
