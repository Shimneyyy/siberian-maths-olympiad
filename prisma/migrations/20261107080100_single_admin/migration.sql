-- At most one technical administrator; no existing account or grant is changed.
CREATE UNIQUE INDEX "User_single_technical_admin" ON "User" (("role")) WHERE "role" = 'TECHNICAL_ADMIN';
