import { olympiadRequest } from "@/lib/olympiad-api";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assignVenueStaff, revokeVenueStaff } from "@/lib/staff";
export const POST = (request: Request) => olympiadRequest(request, async (actorId, body) => {
  const userId = await assignVenueStaff(db, actorId, body);
  const target = await db.user.findUniqueOrThrow({where:{id:userId},select:{email:true}});
  try { await auth.api.requestPasswordReset({body:{email:target.email,redirectTo:"/reset-password"},headers:request.headers}); }
  catch { return Response.json({error:"Назначение сохранено, но письмо не отправлено. Организатор может запросить восстановление пароля.",code:"INVITATION_DELIVERY_FAILED"},{status:503,headers:{"Cache-Control":"private, no-store"}}); }
  return {status:"ok"};
});
export const DELETE = (request: Request) => olympiadRequest(request, async (actorId,body) => { await revokeVenueStaff(db,actorId,body); return {status:"ok"}; });
