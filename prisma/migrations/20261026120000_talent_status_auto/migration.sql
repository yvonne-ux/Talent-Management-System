-- AlterTable
ALTER TABLE "Talent" ADD COLUMN "talentStatusAuto" BOOLEAN NOT NULL DEFAULT true;

-- Statuses already picked by hand stay manual, so the automatic rules don't overwrite them.
UPDATE "Talent" SET "talentStatusAuto" = false WHERE "talentStatus" <> 'Active';
