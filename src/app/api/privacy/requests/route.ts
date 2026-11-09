import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { ownWithdrawalRequests, requestConsentWithdrawal } from "@/lib/data-lifecycle";
export async function GET(request: Request) { return olympiadRequest(request, actorId => ownWithdrawalRequests(db, actorId)); }
export async function POST(request: Request) { return olympiadRequest(request, (actorId, body) => requestConsentWithdrawal(db, actorId, body)); }
