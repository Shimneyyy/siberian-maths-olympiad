import type { Prisma } from "@prisma/client";
// Shared by declarations, confirmations and future allocations. Lock User first
// when mutating a student's records; never acquire another User under this lock.
export async function lockNsuhwNamespace(tx:Prisma.TransactionClient){await tx.$executeRaw`SELECT pg_advisory_xact_lock(4726, 40)`;}
