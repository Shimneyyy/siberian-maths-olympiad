import "server-only";
import { createAuth } from "./auth-core";
import { db } from "./db";
import { sendMail } from "./mail";
export const auth = createAuth(db, sendMail);
