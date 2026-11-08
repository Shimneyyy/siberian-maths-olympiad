CREATE TABLE "NsuhwLoginName" (
 "userId" UUID NOT NULL, "firstNameLatin" VARCHAR(80) NOT NULL, "lastNameLatin" VARCHAR(80) NOT NULL, "revision" INTEGER NOT NULL DEFAULT 0,
 CONSTRAINT "NsuhwLoginName_pkey" PRIMARY KEY ("userId"),
 CONSTRAINT "NsuhwLoginName_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "NsuhwLoginName_parts_check" CHECK ("firstNameLatin" ~ '^[A-Za-z]+$' AND "lastNameLatin" ~ '^[A-Za-z]+$' AND "revision" >= 0)
);
