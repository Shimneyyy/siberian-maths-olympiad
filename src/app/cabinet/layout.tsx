import { requireSession } from "@/lib/session";
import { PrivateSessionBoundary } from "@/components/private-session-boundary";
export default async function CabinetLayout({children}:{children:React.ReactNode}){const {user}=await requireSession();return <PrivateSessionBoundary userId={user.id}>{children}</PrivateSessionBoundary>;}
