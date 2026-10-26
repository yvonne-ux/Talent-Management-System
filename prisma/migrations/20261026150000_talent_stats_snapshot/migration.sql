-- CreateTable
CREATE TABLE "TalentStatsSnapshot" (
    "day" TEXT NOT NULL,
    "stats" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TalentStatsSnapshot_pkey" PRIMARY KEY ("day")
);
