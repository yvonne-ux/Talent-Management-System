import { prisma } from "./prisma";

/** Human labels for each field the Recent changes view reports, per section. Fields not listed
 * here (internal *Seq counters, uploads) are never logged. */
export const FIELD_LABELS: Record<string, Record<string, string>> = {
  personal: {
    name: "Name",
    talentStatus: "Talent status",
    nric: "FIN / NRIC",
    dateOfBirth: "Date of birth",
    sex: "Sex",
    nationality: "Nationality",
    maritalStatus: "Marital status",
    dependants: "Dependants",
    address: "Address",
    contactNumber: "Contact number",
    email: "Email",
    bankAccount: "Bank account",
    jobTitle: "Job title",
    workLocation: "Work location",
    skillset: "Skillset",
    client: "Client",
    projectType: "Project type",
    entity: "Entity",
    caseOwner: "Case owner",
  },
  contract: {
    contractStart: "Contract start",
    contractEnd: "Contract end",
    contractStatus: "Contract status",
    contractRenewalStatus: "Contract renewal status",
    contractRenewalRequired: "Contract renewal required",
    contractLifecycleStatus: "Contract lifecycle status",
    noticePeriod: "Notice period",
    remarks: "Contract remarks",
    renewalRemarks: "Contract renewal remarks",
    sowRequired: "SOW required",
    poRequired: "PO required",
    sowStatus: "SOW status",
    poStatus: "PO status",
    contractNoticeSent: "Contract notice sent",
    clientContactName: "Client contact name",
    clientContactEmail: "Client contact email",
    clientDepartment: "Client department",
    poQuotationNotes: "PO / quotation notes",
  },
  workpass: {
    workPassType: "Work pass type",
    passIssueDate: "Work pass issue date",
    passExpiry: "Work pass expiry",
    passStatus: "Work pass status",
    ipaDate: "IPA date",
    passportExpiry: "Passport expiry",
    medicalCheckupStatus: "Medical check-up status",
    medicalInsuranceStatus: "Medical insurance status",
    wicaCoverageStatus: "WICA coverage status",
    educationVerificationStatus: "Education verification status",
    renewalRequired: "Work pass renewal required",
    renewalStatus: "Work pass renewal status",
    passLifecycleStatus: "Work pass lifecycle status",
    passRenewalRemarks: "Work pass renewal remarks",
    workPassNoticeSent: "Work pass notice sent",
  },
  insurance: {
    policyType: "Policy type",
    policyIssueDate: "Policy issue date",
    policyExpiry: "Policy expiry",
    policyRenewalRequired: "Policy renewal required",
    policyRenewalStatus: "Policy renewal status",
    policyRemarks: "Policy remarks",
    insuranceNoticeSent: "Insurance notice sent",
  },
  payroll: {
    salary: "Salary",
    cpf: "CPF",
    skillsDevelopmentLevy: "Skills Development Levy",
    wica: "WICA",
    medicalInsuranceCost: "Medical insurance cost",
    levy: "Foreign Worker Levy",
    serviceFee: "Service fee",
    allowances: "Allowances",
    claimsReimbursements: "Claims / reimbursements",
    overtime: "Overtime",
    noPayLeaveDeduction: "No-pay leave deduction",
    otherStatutoryCosts: "Other statutory costs",
  },
  billing: {
    chargeRate: "Charge rate",
    billingType: "Billing type",
    talentInvoiceNumber: "Invoice number",
    talentInvoiceDate: "Invoice date",
    talentInvoiceDueDate: "Invoice due date",
    talentInvoiceAmount: "Invoice amount",
    invoiceStatus: "Invoice status",
    talentInvoicePaidDate: "Invoice paid date",
  },
  leave: {
    annualLeaveEntitlement: "Annual leave entitlement",
    annualLeaveTaken: "Annual leave taken",
    sickLeaveEntitlement: "Sick leave entitlement",
    sickLeaveTaken: "Sick leave taken",
    offInLieuEntitlement: "Off-in-lieu entitlement",
    offInLieuTaken: "Off-in-lieu taken",
    unpaidLeaveTaken: "Unpaid leave taken",
    leaveApprovalStatus: "Leave approval status",
    timesheetMonth: "Timesheet month",
    workingDays: "Working days",
    timesheetSubmitted: "Timesheet submitted",
    submissionDate: "Timesheet submission date",
    clientApproved: "Client approved",
    approvalDate: "Client approval date",
    overtimeHours: "Overtime hours",
    absenceDays: "Absence days",
    timesheetRemarks: "Timesheet remarks",
  },
  offboarding: {
    lastWorkingDay: "Last working day",
    resignationReason: "Resignation reason",
    noticeServed: "Notice served",
    workPassCancellationDate: "Work pass cancellation date",
    clientNotified: "Client notified",
    replacementRequired: "Replacement required",
    finalInvoiceIssued: "Final invoice issued",
    exitDocsCompleted: "Exit docs completed",
    offboardingRemarks: "Offboarding remarks",
    offboardingChecklist: "Offboarding checklist",
  },
};

/** Sections hidden from users who can't see financials. */
export const FINANCIAL_SECTIONS = ["payroll", "billing"];

export interface FieldChange {
  field: string;
  fromValue: string | null;
  toValue: string | null;
}

/** Normalises a stored value to the string shown in the log, so equal values compare equal. */
export function displayValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : null;
  if (typeof v === "string") return v.trim() || null;
  return JSON.stringify(v);
}

/** Compares the labelled keys present in `after` against `before` and returns only real changes. */
export function diffFields(section: string, before: Record<string, unknown> | null | undefined, after: Record<string, unknown>): FieldChange[] {
  const labels = FIELD_LABELS[section] ?? {};
  const changes: FieldChange[] = [];
  for (const key of Object.keys(after)) {
    const label = labels[key];
    if (!label) continue;
    const fromValue = displayValue(before?.[key]);
    const toValue = displayValue(after[key]);
    if (fromValue !== toValue) changes.push({ field: label, fromValue, toValue });
  }
  return changes;
}

export interface ChangeContext {
  userId?: string;
  source?: "manual" | "import" | "backfill" | "auto";
}

/** Writes change-log rows for one talent: either a list of field changes (action "updated")
 * or a single added/removed entry. */
export async function logChanges(
  talentId: number,
  section: string,
  changes: FieldChange[] | { action: "added" | "removed" },
  ctx: ChangeContext = {}
) {
  const rows = Array.isArray(changes) ? changes : [{ field: null, fromValue: null, toValue: null }];
  if (rows.length === 0) return;
  const action = Array.isArray(changes) ? "updated" : changes.action;

  const [talent, user] = await Promise.all([
    prisma.talent.findUnique({ where: { id: talentId }, select: { name: true, client: { select: { name: true } } } }),
    ctx.userId ? prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } }) : null,
  ]);

  await prisma.changeLog.createMany({
    data: rows.map((c) => ({
      talentId,
      talentName: talent?.name ?? `Talent ${talentId}`,
      clientName: talent?.client?.name ?? null,
      section,
      action,
      field: c.field,
      fromValue: c.fromValue,
      toValue: c.toValue,
      source: ctx.source ?? "manual",
      userId: ctx.userId ?? null,
      userName: user?.name ?? null,
    })),
  });
}
