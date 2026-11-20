import { auth } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user.emailVerified) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  return Response.json({ user: { id: session.user.id, name: session.user.name, role: session.user.role } }, { headers });
  } catch {return Response.json({error:"Сервис временно недоступен"},{status:503,headers});}
}
