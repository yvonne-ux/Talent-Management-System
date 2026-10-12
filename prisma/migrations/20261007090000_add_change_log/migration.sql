-- CreateTable
CREATE TABLE "ChangeLog" (
    "id" TEXT NOT NULL,
    "talentId" INTEGER,
    "talentName" TEXT NOT NULL,
    "clientName" TEXT,
    "section" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "fromValue" TEXT,
    "toValue" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "userId" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChangeLog_createdAt_idx" ON "ChangeLog"("createdAt");

-- CreateIndex
CREATE INDEX "ChangeLog_talentId_idx" ON "ChangeLog"("talentId");

-- Backfill: one "Talent added" entry per active talent, dated when the talent was created.
INSERT INTO "ChangeLog" ("id", "talentId", "talentName", "clientName", "section", "action", "source", "createdAt")
SELECT 'backfill-' || t."id", t."id", t."name", c."name", 'talent', 'added', 'backfill', t."createdAt"
FROM "Talent" t
LEFT JOIN "Client" c ON c."id" = t."clientId"
WHERE t."active" = true;
