DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "EditionStaffGrant"
    WHERE "revokedAt" IS NULL
    GROUP BY "editionId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Resolve releases with multiple active chief organizers before applying this migration';
  END IF;
END $$;

CREATE UNIQUE INDEX "EditionStaffGrant_one_active_chief"
  ON "EditionStaffGrant" ("editionId")
  WHERE "revokedAt" IS NULL;
