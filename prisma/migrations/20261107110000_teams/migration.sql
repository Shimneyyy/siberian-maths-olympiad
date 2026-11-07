-- CreateTable
CREATE TABLE "Team" (
    "id" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "universityId" UUID NOT NULL,
    "slot" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "coachName" TEXT NOT NULL,
    "captainParticipationId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "participationId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "universityId" UUID NOT NULL,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("participationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_captainParticipationId_key" ON "Team"("captainParticipationId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_captainParticipationId_editionId_universityId_key" ON "Team"("captainParticipationId", "editionId", "universityId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_editionId_universityId_slot_key" ON "Team"("editionId", "universityId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "Team_id_editionId_universityId_key" ON "Team"("id", "editionId", "universityId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_participationId_editionId_universityId_key" ON "TeamMember"("participationId", "editionId", "universityId");

-- CreateIndex
CREATE UNIQUE INDEX "Participation_id_editionId_universityId_key" ON "Participation"("id", "editionId", "universityId");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "OlympiadEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_captainParticipationId_editionId_universityId_fkey" FOREIGN KEY ("captainParticipationId", "editionId", "universityId") REFERENCES "Participation"("id", "editionId", "universityId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_participationId_editionId_universityId_fkey" FOREIGN KEY ("participationId", "editionId", "universityId") REFERENCES "Participation"("id", "editionId", "universityId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_editionId_universityId_fkey" FOREIGN KEY ("teamId", "editionId", "universityId") REFERENCES "Team"("id", "editionId", "universityId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Stable slots enforce the three-team university/year limit in the database.
ALTER TABLE "Team" ADD CONSTRAINT "Team_slot_check" CHECK ("slot" BETWEEN 1 AND 3);
-- Serializes concurrent membership inserts even outside the application service.
CREATE FUNCTION enforce_team_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "id" FROM "Team" WHERE "id" = NEW."teamId" FOR UPDATE;
  IF (SELECT count(*) FROM "TeamMember" WHERE "teamId" = NEW."teamId" AND "participationId" <> NEW."participationId") >= 5 THEN
    RAISE EXCEPTION 'Team capacity exceeded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "TeamMember_capacity" BEFORE INSERT OR UPDATE ON "TeamMember"
 FOR EACH ROW EXECUTE FUNCTION enforce_team_capacity();
