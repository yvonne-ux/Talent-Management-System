-- AlterTable
ALTER TABLE "Talent" ADD COLUMN "talentStatus" TEXT NOT NULL DEFAULT 'Active';

-- The old "Inactive" overrides become the new statuses: an inactive contract is "Contract Ended"
-- and an inactive work pass is "Cancelled".
UPDATE "Contract" SET "contractStatus" = 'Contract Ended', "contractLifecycleStatus" = '' WHERE "contractLifecycleStatus" = 'Inactive';
UPDATE "WorkPass" SET "passStatus" = 'Cancelled', "passLifecycleStatus" = '' WHERE "passLifecycleStatus" = 'Inactive';
