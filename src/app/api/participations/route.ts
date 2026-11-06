import { olympiadRequest } from "@/lib/olympiad-api";
import { registerParticipation } from "@/lib/olympiad";
import { studentOlympiadView } from "@/lib/olympiad-view";
import { db } from "@/lib/db";
export const GET = (request: Request) => olympiadRequest(request, (actorId) => studentOlympiadView(db, actorId));
export const POST = (request: Request) => olympiadRequest(request, async (actorId, body) => {
  const result = await registerParticipation(db, actorId, body);
  return { id: result.id, editionId: result.editionId, status: result.status };
});
