import { Prisma } from "@prisma/client";
import { daysLeft, contractStatusDisplay, passStatusDisplay, isExpiringSoon, isContractClosed, isPassClosed } from "../../lib/computed";
import { fromJson } from "../../lib/json";
import { COST_FIELD_LABELS } from "../../lib/costChanges";

const talentWithRelations = Prisma.validator<Prisma.TalentDefaultArgs>()({
  include: {
    client: true,
    projectType: true,
    entity: true,
    caseOwner: true,
    contract: true,
    workPass: true,
    insurance: true,
    payroll: true,
    talentBilling: true,
    leaveTimesheet: true,
    offboarding: true,
    salaryChanges: { orderBy: { effectiveDate: "desc" } },
    costChanges: { orderBy: { effectiveDate: "desc" } },
  },
});
export type TalentWithRelations = Prisma.TalentGetPayload<typeof talentWithRelations>;
export const talentInclude = talentWithRelations.include;

function costChangeItems(c: TalentWithRelations["costChanges"][number]) {
  return (Object.keys(COST_FIELD_LABELS) as (keyof typeof c)[])
    .filter((k) => k in c && c[k] !== null && k !== "billingType")
    .map((k) => ({ label: COST_FIELD_LABELS[k as string] + (k === "chargeRate" && c.billingType ? ` (${c.billingType})` : ""), value: c[k] as number }));
}

function yn(value: boolean | null | undefined): "Yes" | "No" {
  return value ? "Yes" : "No";
}

const PAYROLL_FIELDS = [
  "salary", "cpf", "skillsDevelopmentLevy", "wica", "medicalInsuranceCost", "levy", "serviceFee",
  "allowances", "claimsReimbursements", "overtime", "noPayLeaveDeduction", "otherStatutoryCosts",
] as const;
const BILLING_FIELDS = [
  "chargeRate", "talentInvoiceNumber", "talentInvoiceDate", "talentInvoiceDueDate",
  "talentInvoiceAmount", "invoiceStatus", "talentInvoicePaidDate",
] as const;

/** Flattens the normalized Talent + child records into the single wide object shape
 * the mockup frontend's render functions expect (talent.contractStart, talent.workPassType, etc).
 * `canViewFinancials` gates payroll/billing figures — set false to null them out for a
 * Standard-role viewer without financials access (server-side redaction, not just UI hiding).
 */
export function serializeTalent(t: TalentWithRelations, canViewFinancials = true) {
  const contractDaysLeftValue = t.contract ? daysLeft(t.contract.contractEnd) : null;
  const passDaysLeftValue = t.workPass ? daysLeft(t.workPass.passExpiry) : null;
  const policyDaysLeftValue = t.insurance ? daysLeft(t.insurance.policyExpiry) : null;
  const contractClosed = isContractClosed(t.talentStatus, t.contract?.contractStatus, t.contract?.contractLifecycleStatus);
  const passClosed = isPassClosed(t.talentStatus, t.workPass?.passStatus, t.workPass?.passLifecycleStatus);
  const alert =
    (!passClosed && passDaysLeftValue !== null && passDaysLeftValue <= 30) ||
    (!contractClosed && contractDaysLeftValue !== null && contractDaysLeftValue <= 30);

  const result = {
    id: t.id,
    firstName: t.firstName,
    lastName: t.lastName,
    name: t.name,
    nric: t.nric,
    dateOfBirth: t.dateOfBirth,
    sex: t.sex,
    nationality: t.nationality,
    maritalStatus: t.maritalStatus,
    dependants: t.dependants,
    address: t.address,
    contactNumber: t.contactNumber,
    email: t.email,
    bankAccount: t.bankAccount,
    jobTitle: t.jobTitle,
    skillset: fromJson<string[]>(t.skillset, []),
    workLocation: t.workLocation,
    talentStatus: t.talentStatus,

    client: t.client?.name ?? null,
    clientId: t.clientId,
    projectType: t.projectType?.name ?? null,
    projectTypeId: t.projectTypeId,
    entity: t.entity?.name ?? null,
    entityId: t.entityId,
    caseOwner: t.caseOwner?.name ?? null,
    caseOwnerId: t.caseOwnerId,

    // Contract
    contractStart: t.contract?.contractStart ?? null,
    contractEnd: t.contract?.contractEnd ?? null,
    contractStatus: t.contract?.contractStatus ?? null,
    noticePeriod: t.contract?.noticePeriod ?? null,
    contractUpload: t.contract?.contractUpload ?? null,
    signedContractUpload: t.contract?.signedContractUpload ?? null,
    contractRenewalRequired: yn(t.contract?.contractRenewalRequired),
    contractRenewalStatus: t.contract?.contractRenewalStatus ?? null,
    contractLifecycleStatus: t.contract?.contractLifecycleStatus ?? "",
    remarks: t.contract?.remarks ?? null,
    renewalRemarks: t.contract?.renewalRemarks ?? "",
    sowRequired: yn(t.contract?.sowRequired),
    poRequired: yn(t.contract?.poRequired),
    sowStatus: t.contract?.sowStatus ?? null,
    poStatus: t.contract?.poStatus ?? null,
    renewalCompletedSeq: t.contract?.renewalCompletedSeq ?? 0,
    datesUpdatedSeq: t.contract?.datesUpdatedSeq ?? 0,
    contractNoticeSent: t.contract?.contractNoticeSent ?? false,
    contractDaysLeft: contractDaysLeftValue,
    clientContactName: t.contract?.clientContactName ?? null,
    clientContactEmail: t.contract?.clientContactEmail ?? null,
    clientDepartment: t.contract?.clientDepartment ?? null,
    poQuotationNotes: t.contract?.poQuotationNotes ?? null,

    // Work Pass
    workPassType: t.workPass?.workPassType ?? null,
    passIssueDate: t.workPass?.passIssueDate ?? null,
    passExpiry: t.workPass?.passExpiry ?? null,
    passStatus: t.workPass?.passStatus ?? null,
    ipaDate: t.workPass?.ipaDate ?? null,
    passportExpiry: t.workPass?.passportExpiry ?? null,
    medicalCheckupStatus: t.workPass?.medicalCheckupStatus ?? null,
    medicalInsuranceStatus: t.workPass?.medicalInsuranceStatus ?? null,
    wicaCoverageStatus: t.workPass?.wicaCoverageStatus ?? null,
    renewalRequired: yn(t.workPass?.renewalRequired),
    renewalStatus: t.workPass?.renewalStatus ?? null,
    educationVerificationStatus: t.workPass?.educationVerificationStatus ?? null,
    passLifecycleStatus: t.workPass?.passLifecycleStatus ?? "",
    passRenewalRemarks: t.workPass?.passRenewalRemarks ?? "",
    passRenewalCompletedSeq: t.workPass?.passRenewalCompletedSeq ?? 0,
    passDatesUpdatedSeq: t.workPass?.passDatesUpdatedSeq ?? 0,
    workPassNoticeSent: t.workPass?.workPassNoticeSent ?? false,
    passDaysLeft: passDaysLeftValue,

    // Insurance
    policyType: t.insurance?.policyType ?? null,
    policyIssueDate: t.insurance?.policyIssueDate ?? null,
    policyExpiry: t.insurance?.policyExpiry ?? null,
    policyRenewalRequired: yn(t.insurance?.policyRenewalRequired),
    policyRenewalStatus: t.insurance?.policyRenewalStatus ?? null,
    policyRemarks: t.insurance?.policyRemarks ?? "",
    insuranceNoticeSent: t.insurance?.insuranceNoticeSent ?? false,
    policyRenewalCompletedSeq: t.insurance?.policyRenewalCompletedSeq ?? 0,
    policyDatesUpdatedSeq: t.insurance?.policyDatesUpdatedSeq ?? 0,
    policyDaysLeft: policyDaysLeftValue,

    // Payroll
    salary: t.payroll?.salary ?? 0,
    cpf: t.payroll?.cpf ?? 0,
    skillsDevelopmentLevy: t.payroll?.skillsDevelopmentLevy ?? 0,
    wica: t.payroll?.wica ?? 0,
    medicalInsuranceCost: t.payroll?.medicalInsuranceCost ?? 0,
    levy: t.payroll?.levy ?? 0,
    serviceFee: t.payroll?.serviceFee ?? 0,
    allowances: t.payroll?.allowances ?? 0,
    claimsReimbursements: t.payroll?.claimsReimbursements ?? 0,
    overtime: t.payroll?.overtime ?? 0,
    noPayLeaveDeduction: t.payroll?.noPayLeaveDeduction ?? 0,
    otherStatutoryCosts: t.payroll?.otherStatutoryCosts ?? 0,
    // Salary changes already in effect (newest first), and one waiting for its effective date.
    salaryHistory: t.salaryChanges
      .filter((s) => s.appliedAt)
      .map((s) => ({ fromSalary: s.fromSalary, toSalary: s.toSalary, effectiveDate: s.effectiveDate })),
    pendingSalary: (() => {
      // The next one to take effect (an import can queue several).
      const p = t.salaryChanges.filter((s) => !s.appliedAt).at(-1);
      return p ? { toSalary: p.toSalary, effectiveDate: p.effectiveDate, remarks: p.remarks } : null;
    })(),
    // Every salary, cost item and charge rate change still waiting for its date, soonest first,
    // and the cost changes (other than salary) already in effect, newest first.
    scheduledCostChanges: (() => {
      const byDate = new Map<number, { effectiveDate: Date; items: { label: string; value: number }[] }>();
      const add = (d: Date, items: { label: string; value: number }[]) => {
        const entry = byDate.get(d.getTime()) ?? { effectiveDate: d, items: [] };
        entry.items.push(...items);
        byDate.set(d.getTime(), entry);
      };
      for (const s of t.salaryChanges) if (!s.appliedAt) add(s.effectiveDate, [{ label: "Salary", value: s.toSalary }]);
      for (const c of t.costChanges) if (!c.appliedAt) add(c.effectiveDate, costChangeItems(c));
      return [...byDate.values()].sort((a, b) => a.effectiveDate.getTime() - b.effectiveDate.getTime());
    })(),
    costHistory: t.costChanges.filter((c) => c.appliedAt).slice(0, 10).map((c) => ({ effectiveDate: c.effectiveDate, items: costChangeItems(c) })),

    // Talent Billing
    chargeRate: t.talentBilling?.chargeRate ?? 0,
    billingType: t.talentBilling?.billingType ?? "Monthly",
    talentInvoiceNumber: t.talentBilling?.talentInvoiceNumber ?? null,
    talentInvoiceDate: t.talentBilling?.talentInvoiceDate ?? null,
    talentInvoiceDueDate: t.talentBilling?.talentInvoiceDueDate ?? null,
    talentInvoiceAmount: t.talentBilling?.talentInvoiceAmount ?? 0,
    invoiceStatus: t.talentBilling?.invoiceStatus ?? null,
    talentInvoicePaidDate: t.talentBilling?.talentInvoicePaidDate ?? null,

    // Leave & Timesheet
    annualLeaveEntitlement: t.leaveTimesheet?.annualLeaveEntitlement ?? 0,
    annualLeaveTaken: t.leaveTimesheet?.annualLeaveTaken ?? 0,
    annualLeaveBalance: (t.leaveTimesheet?.annualLeaveEntitlement ?? 0) - (t.leaveTimesheet?.annualLeaveTaken ?? 0),
    sickLeaveEntitlement: t.leaveTimesheet?.sickLeaveEntitlement ?? 0,
    sickLeaveTaken: t.leaveTimesheet?.sickLeaveTaken ?? 0,
    sickLeaveBalance: (t.leaveTimesheet?.sickLeaveEntitlement ?? 0) - (t.leaveTimesheet?.sickLeaveTaken ?? 0),
    offInLieuEntitlement: t.leaveTimesheet?.offInLieuEntitlement ?? 0,
    offInLieuTaken: t.leaveTimesheet?.offInLieuTaken ?? 0,
    offInLieuBalance: (t.leaveTimesheet?.offInLieuEntitlement ?? 0) - (t.leaveTimesheet?.offInLieuTaken ?? 0),
    unpaidLeaveTaken: t.leaveTimesheet?.unpaidLeaveTaken ?? 0,
    mcUpload: t.leaveTimesheet?.mcUpload ?? null,
    leaveApprovalStatus: t.leaveTimesheet?.leaveApprovalStatus ?? null,
    timesheetMonth: t.leaveTimesheet?.timesheetMonth ?? null,
    workingDays: t.leaveTimesheet?.workingDays ?? null,
    timesheetSubmitted: yn(t.leaveTimesheet?.timesheetSubmitted),
    submissionDate: t.leaveTimesheet?.submissionDate ?? null,
    clientApproved: yn(t.leaveTimesheet?.clientApproved),
    approvalDate: t.leaveTimesheet?.approvalDate ?? null,
    overtimeHours: t.leaveTimesheet?.overtimeHours ?? 0,
    absenceDays: t.leaveTimesheet?.absenceDays ?? 0,
    timesheetRemarks: t.leaveTimesheet?.timesheetRemarks ?? null,

    // Offboarding
    lastWorkingDay: t.offboarding?.lastWorkingDay ?? null,
    resignationReason: t.offboarding?.resignationReason ?? null,
    noticeServed: t.offboarding?.noticeServed ?? null,
    workPassCancellationDate: t.offboarding?.workPassCancellationDate ?? null,
    clientNotified: t.offboarding?.clientNotified ?? null,
    replacementRequired: t.offboarding?.replacementRequired ?? null,
    finalInvoiceIssued: t.offboarding?.finalInvoiceIssued ?? null,
    exitDocsCompleted: t.offboarding?.exitDocsCompleted ?? null,
    offboardingRemarks: t.offboarding?.offboardingRemarks ?? null,
    offboardingChecklist: fromJson<{ label: string; status: string }[]>(t.offboarding?.offboardingChecklist ?? null, []),

    alert,
    contractStatusLabel: contractStatusDisplay(contractDaysLeftValue, t.contract?.contractLifecycleStatus, t.talentStatus, t.contract?.contractStatus),
    passStatusLabel: t.workPass ? passStatusDisplay(t.workPass.workPassType, passDaysLeftValue, t.workPass.passLifecycleStatus, t.talentStatus, t.workPass.passStatus) : null,
    contractExpiringSoon: !contractClosed && isExpiringSoon(contractDaysLeftValue),
    passExpiringSoon: !passClosed && isExpiringSoon(passDaysLeftValue),
  };

  if (!canViewFinancials) {
    for (const key of PAYROLL_FIELDS) (result as Record<string, unknown>)[key] = null;
    for (const key of BILLING_FIELDS) (result as Record<string, unknown>)[key] = null;
    (result as Record<string, unknown>).salaryHistory = [];
    (result as Record<string, unknown>).pendingSalary = null;
    (result as Record<string, unknown>).scheduledCostChanges = [];
    (result as Record<string, unknown>).costHistory = [];
  }

  return result;
}

export type SerializedTalent = ReturnType<typeof serializeTalent>;
