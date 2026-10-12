-- CreateTable
CREATE TABLE "SalaryChange" (
    "id" TEXT NOT NULL,
    "talentId" INTEGER NOT NULL,
    "fromSalary" DOUBLE PRECISION,
    "toSalary" DOUBLE PRECISION NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "remarks" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalaryChange_talentId_idx" ON "SalaryChange"("talentId");

-- CreateIndex
CREATE INDEX "SalaryChange_appliedAt_effectiveDate_idx" ON "SalaryChange"("appliedAt", "effectiveDate");

-- AddForeignKey
ALTER TABLE "SalaryChange" ADD CONSTRAINT "SalaryChange_talentId_fkey" FOREIGN KEY ("talentId") REFERENCES "Talent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
