-- CreateTable
CREATE TABLE "CostChange" (
    "id" TEXT NOT NULL,
    "talentId" INTEGER NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "cpf" DOUBLE PRECISION,
    "skillsDevelopmentLevy" DOUBLE PRECISION,
    "wica" DOUBLE PRECISION,
    "medicalInsuranceCost" DOUBLE PRECISION,
    "levy" DOUBLE PRECISION,
    "serviceFee" DOUBLE PRECISION,
    "allowances" DOUBLE PRECISION,
    "otherStatutoryCosts" DOUBLE PRECISION,
    "totalEmploymentCost" DOUBLE PRECISION,
    "chargeRate" DOUBLE PRECISION,
    "billingType" TEXT,
    "previousValues" TEXT,
    "remarks" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostChange_talentId_idx" ON "CostChange"("talentId");

-- CreateIndex
CREATE INDEX "CostChange_appliedAt_effectiveDate_idx" ON "CostChange"("appliedAt", "effectiveDate");

-- AddForeignKey
ALTER TABLE "CostChange" ADD CONSTRAINT "CostChange_talentId_fkey" FOREIGN KEY ("talentId") REFERENCES "Talent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
