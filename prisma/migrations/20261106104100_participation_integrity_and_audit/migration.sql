-- DropForeignKey
ALTER TABLE "Participation" DROP CONSTRAINT "Participation_consentId_fkey";

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "details" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "ConsentRecord_id_userId_key" ON "ConsentRecord"("id", "userId");

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_consentId_userId_fkey" FOREIGN KEY ("consentId", "userId") REFERENCES "ConsentRecord"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

