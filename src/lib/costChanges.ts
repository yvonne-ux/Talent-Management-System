import type { CostChange, Payroll, TalentBilling } from "@prisma/client";
import { prisma } from "./prisma";
import { logChanges, FieldChange } from "./changeLog";
import { applyDueSalaryChanges, cpfAfterSalaryChange, fmtEffectiveDate, laterAppliedSalaryDate, recordSalaryChange } from "./salaryChanges";

/** Payroll cost items a cost change can set directly. */
export const PAYROLL_COST_FIELDS = [
  "cpf", "skillsDevelopmentLevy", "wica", "medicalInsuranceCost", "levy", "serviceFee", "allowances", "otherStatutoryCosts",
] as const;
type PayrollCostField = (typeof PAYROLL_COST_FIELDS)[number];

export const COST_FIELD_LABELS: Record<string, string> = {
  salary: "Salary",
  cpf: "CPF",
  skillsDevelopmentLevy: "Skills Development Levy",
  wica: "WICA",
  medicalInsuranceCost: "Medical insurance cost",
  levy: "Foreign Worker Levy",
  serviceFee: "Service fee",
  allowances: "Allowances",
  otherStatutoryCosts: "Other statutory costs",
  totalEmploymentCost: "Total employment cost",
  chargeRate: "Charge rate",
  billingType: "Billing type",
};

export interface CostValues {
  cpf?: number;
  skillsDevelopmentLevy?: number;
  wica?: number;
  medicalInsuranceCost?: number;
  levy?: number;
  serviceFee?: number;
  allowances?: number;
  otherStatutoryCosts?: number;
  totalEmploymentCost?: number;
  chargeRate?: number;
  billingType?: "Monthly" | "Daily";
}

type PayrollCosts = Pick<Payroll, "salary" | PayrollCostField>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Total employment cost as the Payroll & Cost view shows it: salary plus the statutory items. */
export function totalEmploymentCostOf(p: PayrollCosts): number {
  return round2(p.salary + p.cpf + p.levy + p.skillsDevelopmentLevy + p.wica + p.medicalInsuranceCost + p.otherStatutoryCosts);
}

/** A target total is met by setting Other statutory costs to whatever the itemised costs leave. */
function otherCostsForTotal(p: PayrollCosts, total: number): number {
  return Math.max(0, round2(total - (p.salary + p.cpf + p.levy + p.skillsDevelopmentLevy + p.wica + p.medicalInsuranceCost)));
}

/** Total employment cost and Other statutory costs both end up setting the same Payroll column. */
const fieldGroup = (field: string) => (field === "totalEmploymentCost" ? "otherStatutoryCosts" : field);

/** Fields a later-dated change already in effect has set: a back-dated change must not overwrite them. */
async function fieldsSupersededAfter(talentId: number, effectiveDate: Date): Promise<Map<string, Date>> {
  const later = await prisma.costChange.findMany({
    where: { talentId, appliedAt: { not: null }, effectiveDate: { gt: effectiveDate } },
    orderBy: { effectiveDate: "desc" },
  });
  const out = new Map<string, Date>();
  for (const c of later) {
    for (const field of [...PAYROLL_COST_FIELDS, "totalEmploymentCost", "chargeRate", "billingType"] as const) {
      if (c[field] !== null && !out.has(fieldGroup(field))) out.set(fieldGroup(field), c.effectiveDate);
    }
  }
  return out;
}

function changedFields(values: CostValues | CostChange): string[] {
  return Object.keys(COST_FIELD_LABELS).filter(
    (k) => k !== "salary" && (values as unknown as Record<string, unknown>)[k] !== null && (values as unknown as Record<string, unknown>)[k] !== undefined
  );
}

/** Copies one cost change onto Payroll / TalentBilling and marks it applied. */
async function applyCostChange(change: CostChange) {
  const superseded = await fieldsSupersededAfter(change.talentId, change.effectiveDate);
  const payroll = (await prisma.payroll.findUnique({ where: { talentId: change.talentId } }))
    ?? (await prisma.payroll.create({ data: { talentId: change.talentId } }));
  const billing: TalentBilling = (await prisma.talentBilling.findUnique({ where: { talentId: change.talentId } }))
    ?? (await prisma.talentBilling.create({ data: { talentId: change.talentId } }));

  const payrollData: Partial<Record<PayrollCostField, number>> = {};
  for (const field of PAYROLL_COST_FIELDS) {
    const v = change[field];
    if (v !== null && !superseded.has(field)) payrollData[field] = v;
  }
  if (change.totalEmploymentCost !== null && !superseded.has("otherStatutoryCosts")) {
    payrollData.otherStatutoryCosts = otherCostsForTotal({ ...payroll, ...payrollData }, change.totalEmploymentCost);
  }
  const billingData: { chargeRate?: number; billingType?: string } = {};
  if (change.chargeRate !== null && !superseded.has("chargeRate")) billingData.chargeRate = change.chargeRate;
  if (change.billingType !== null && !superseded.has("billingType")) billingData.billingType = change.billingType;

  const previous: Record<string, unknown> = {};
  for (const k of Object.keys(payrollData)) previous[k] = payroll[k as PayrollCostField];
  for (const k of Object.keys(billingData)) previous[k] = billing[k as keyof typeof billingData];

  if (Object.keys(payrollData).length) await prisma.payroll.update({ where: { talentId: change.talentId }, data: payrollData });
  if (Object.keys(billingData).length) await prisma.talentBilling.update({ where: { talentId: change.talentId }, data: billingData });
  await prisma.costChange.update({
    where: { id: change.id },
    data: { appliedAt: new Date(), previousValues: JSON.stringify(previous) },
  });
}

/** Records a dated change to cost items and/or the charge rate. Dated today or earlier it applies
 * straight away; dated later it waits for applyDueCostChanges(). A pending change for the same
 * talent and the same date is replaced, so re-importing a sheet doesn't stack duplicates. */
export async function recordCostChange(
  talentId: number,
  values: CostValues,
  effectiveDate: Date,
  opts: { userId?: string; remarks?: string | null; source?: "manual" | "import" } = {}
) {
  const fields = changedFields(values);
  if (!fields.length) return;
  const [payroll, billing, superseded] = await Promise.all([
    prisma.payroll.findUnique({ where: { talentId } }),
    prisma.talentBilling.findUnique({ where: { talentId } }),
    fieldsSupersededAfter(talentId, effectiveDate),
  ]);
  const due = effectiveDate.getTime() <= Date.now();

  await prisma.costChange.deleteMany({ where: { talentId, appliedAt: null, effectiveDate } });
  const change = await prisma.costChange.create({
    data: { talentId, effectiveDate, ...values, remarks: opts.remarks ?? null, userId: opts.userId ?? null },
  });
  if (due) await applyCostChange(change);

  const current: Record<string, unknown> = {
    ...(payroll ?? {}),
    chargeRate: billing?.chargeRate,
    billingType: billing?.billingType,
    totalEmploymentCost: payroll ? totalEmploymentCostOf(payroll) : null,
  };
  const when = fmtEffectiveDate(effectiveDate);
  const logFields = fields.filter((f) => (values as Record<string, unknown>)[f] !== current[f]);
  const log: FieldChange[] = logFields.map((f) => ({
    field: `${COST_FIELD_LABELS[f]} (effective ${when}${due && superseded.has(fieldGroup(f)) ? ", history only: a later change is in effect" : ""})`,
    fromValue: current[f] === null || current[f] === undefined ? null : String(current[f]),
    toValue: String((values as Record<string, unknown>)[f]),
  }));
  const isBilling = (f: string) => f === "chargeRate" || f === "billingType";
  const billingLog = log.filter((_, i) => isBilling(logFields[i]));
  const payrollLog = log.filter((_, i) => !isBilling(logFields[i]));
  await logChanges(talentId, "payroll", payrollLog, { userId: opts.userId, source: opts.source });
  await logChanges(talentId, "billing", billingLog, { userId: opts.userId, source: opts.source });
}

/** Applies every pending cost change whose effective date has arrived, oldest first. */
export async function applyDueCostChanges() {
  const due = await prisma.costChange.findMany({
    where: { appliedAt: null, effectiveDate: { lte: new Date() } },
    orderBy: { effectiveDate: "asc" },
  });
  for (const change of due) await applyCostChange(change);
}

/** Brings salaries and other costs up to date. Salary goes first so a Total employment cost
 * dated the same day is worked out against the new salary. */
export async function applyDueChanges() {
  await applyDueSalaryChanges();
  await applyDueCostChanges();
}

// ---------- Cost-change import ----------

export interface CostImportRow {
  talentCode?: string;
  name?: string;
  finNo?: string;
  client?: string;
  effectiveDate?: string;
  basicSalary?: number;
  cpf?: number;
  skillsDevelopmentLevy?: number;
  wica?: number;
  medicalInsuranceCost?: number;
  levy?: number;
  serviceFee?: number;
  allowances?: number;
  otherStatutoryCosts?: number;
  totalEmploymentCost?: number;
  monthlyChargeRate?: number;
  dailyChargeRate?: number;
  chargeRate?: number; // a plain "Charge Rate" column keeps the talent's current billing type
  remarks?: string;
  _sheetRow?: number; // the row number in the uploaded sheet, for messages
}

export interface CostImportResult {
  row: number;
  name: string;
  talentId?: number;
  talentName?: string;
  client?: string | null;
  effectiveDate?: string;
  status: "now" | "scheduled" | "skipped";
  reason?: string;
  changes: { field: string; label: string; from: number | string | null; to: number | string; historyOnly?: boolean }[];
  warnings: string[];
}

// FIN values that mean "no FIN on file" (same markers as the talent import).
const NO_FIN_MARKERS = new Set(["na", "n/a", "-", "nil", "none", "not applicable"]);

async function matchTalent(r: CostImportRow): Promise<{ id: number; name: string; client: string | null } | { error: string }> {
  const select = { id: true, name: true, client: { select: { name: true } } } as const;
  const pick = (t: { id: number; name: string; client: { name: string } | null }) => ({ id: t.id, name: t.name, client: t.client?.name ?? null });

  const code = (r.talentCode ?? "").toString().trim();
  if (code) {
    const m = code.match(/^C?0*(\d+)$/i);
    if (!m) return { error: `Talent ID "${code}" isn't in the C000123 format` };
    const t = await prisma.talent.findFirst({ where: { id: Number(m[1]), active: true }, select });
    if (!t) return { error: `no active talent with ID ${code}` };
    return pick(t);
  }
  const fin = (r.finNo ?? "").toString().trim();
  if (fin && !NO_FIN_MARKERS.has(fin.toLowerCase())) {
    const matches = await prisma.talent.findMany({ where: { nric: { equals: fin, mode: "insensitive" }, active: true }, select });
    if (matches.length === 1) return pick(matches[0]);
    if (matches.length > 1) return { error: `${matches.length} talents share FIN ${fin}; add the Talent ID` };
  }
  const name = (r.name ?? "").toString().trim();
  if (!name) return { error: "no Talent ID, FIN No. or Name to match on" };
  const client = (r.client ?? "").toString().trim();
  const matches = await prisma.talent.findMany({
    where: {
      name: { equals: name, mode: "insensitive" },
      active: true,
      ...(client ? { client: { name: { equals: client, mode: "insensitive" } } } : {}),
    },
    select,
  });
  if (matches.length === 1) return pick(matches[0]);
  if (matches.length > 1) return { error: `${matches.length} talents are named "${name}"; add the Client or Talent ID` };
  return { error: fin && !NO_FIN_MARKERS.has(fin.toLowerCase()) ? `no talent with FIN ${fin} or name "${name}"${client ? ` under ${client}` : ""}` : `no talent named "${name}"${client ? ` under ${client}` : ""}` };
}

function numberOrUndefined(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Checks (dryRun) or records every row of a cost-change sheet. Rows only ever update existing
 * talents; anything that can't be matched or has no effective date is skipped with a reason. */
export async function importCostChanges(rows: CostImportRow[], opts: { dryRun: boolean; userId?: string }) {
  const results: CostImportResult[] = [];
  const seen = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? {};
    const rowNo = Number(r._sheetRow) || i + 2; // sheet row number (row 1 is the header)
    const label = (r.name ?? r.talentCode ?? r.finNo ?? "").toString().trim() || "(no name)";
    const result: CostImportResult = { row: rowNo, name: label, status: "skipped", changes: [], warnings: [] };
    results.push(result);

    const effectiveDate = r.effectiveDate ? new Date(r.effectiveDate) : null;
    if (!effectiveDate || Number.isNaN(effectiveDate.getTime())) { result.reason = "no Effective Date"; continue; }
    result.effectiveDate = effectiveDate.toISOString();

    const salary = numberOrUndefined(r.basicSalary);
    const daily = numberOrUndefined(r.dailyChargeRate);
    const monthly = numberOrUndefined(r.monthlyChargeRate);
    const values: CostValues = {};
    for (const f of PAYROLL_COST_FIELDS) {
      const v = numberOrUndefined(r[f]);
      if (v !== undefined) values[f] = v;
    }
    const total = numberOrUndefined(r.totalEmploymentCost);
    if (total !== undefined) {
      values.totalEmploymentCost = total;
      if (values.otherStatutoryCosts !== undefined) {
        result.warnings.push("Total Employment Cost and Other Statutory Costs both filled in; Other Statutory Costs is worked out from the total");
        delete values.otherStatutoryCosts;
      }
    }
    if (daily !== undefined) {
      values.chargeRate = daily;
      values.billingType = "Daily";
      if (monthly !== undefined) result.warnings.push("both Daily and Monthly Charge Rate filled in; the daily rate is used");
    } else if (monthly !== undefined) {
      values.chargeRate = monthly;
      values.billingType = "Monthly";
    } else if (numberOrUndefined(r.chargeRate) !== undefined) {
      values.chargeRate = numberOrUndefined(r.chargeRate);
    }
    const negative = [salary, ...Object.values(values)].some((v) => typeof v === "number" && v < 0);
    if (negative) { result.reason = "a cost figure is negative"; continue; }
    if (salary === undefined && !changedFields(values).length) { result.reason = "no cost figures filled in"; continue; }

    const match = await matchTalent(r);
    if ("error" in match) { result.reason = match.error; continue; }
    result.talentId = match.id;
    result.talentName = match.name;
    result.client = match.client;
    if (r.name && r.name.toString().trim().toLowerCase() !== match.name.toLowerCase()) {
      result.warnings.push(`matched to ${match.name}, whose name differs from "${r.name}"`);
    }
    const key = `${match.id}|${effectiveDate.getTime()}`;
    if (seen.has(key)) result.warnings.push(`same talent and date as row ${seen.get(key)}; this row replaces it`);
    seen.set(key, rowNo);

    const due = effectiveDate.getTime() <= Date.now();
    result.status = due ? "now" : "scheduled";

    // Preview: what each field is today and what it becomes.
    const [payroll, billing, superseded, laterSalary] = await Promise.all([
      prisma.payroll.findUnique({ where: { talentId: match.id } }),
      prisma.talentBilling.findUnique({ where: { talentId: match.id } }),
      fieldsSupersededAfter(match.id, effectiveDate),
      salary !== undefined ? laterAppliedSalaryDate(match.id, effectiveDate) : Promise.resolve(null),
    ]);
    const historyNote = (later: Date) => `effective date is before a change already in effect from ${fmtEffectiveDate(later)}, so it is kept as history only`;
    // CPF that was the automatic 17% follows the new salary (see recordSalaryChange) unless the row sets CPF.
    const cpfFollowingSalary = salary !== undefined && values.cpf === undefined && payroll
      ? cpfAfterSalaryChange(payroll.cpf, payroll.salary, salary) : undefined;
    if (salary !== undefined && salary !== payroll?.salary) {
      const historyOnly = due && laterSalary !== null;
      result.changes.push({ field: "salary", label: COST_FIELD_LABELS.salary, from: payroll?.salary ?? null, to: salary, historyOnly });
      if (historyOnly) result.warnings.push(`Salary: ${historyNote(laterSalary!)}`);
      else if (cpfFollowingSalary !== undefined && cpfFollowingSalary !== payroll?.cpf) {
        result.changes.push({ field: "cpf", label: "CPF (17% of new salary)", from: payroll?.cpf ?? null, to: cpfFollowingSalary });
      }
    }
    const currentValues: Record<string, number | string | null> = {
      ...Object.fromEntries(PAYROLL_COST_FIELDS.map((f) => [f, payroll?.[f] ?? null])),
      totalEmploymentCost: payroll ? totalEmploymentCostOf(payroll) : null,
      chargeRate: billing?.chargeRate ?? null,
      billingType: billing?.billingType ?? null,
    };
    for (const f of changedFields(values)) {
      const later = superseded.get(fieldGroup(f));
      const historyOnly = due && !!later;
      const to = (values as Record<string, number | string>)[f];
      if (to === currentValues[f]) continue; // already the current figure
      const label = f === "chargeRate" && values.billingType ? `${COST_FIELD_LABELS[f]} (${values.billingType})` : COST_FIELD_LABELS[f];
      result.changes.push({ field: f, label, from: currentValues[f], to, historyOnly });
      if (historyOnly) result.warnings.push(`${COST_FIELD_LABELS[f]}: ${historyNote(later!)}`);
    }
    if (total !== undefined) {
      const after = {
        salary: salary ?? payroll?.salary ?? 0,
        ...Object.fromEntries(PAYROLL_COST_FIELDS.map((f) => [f, (values[f] as number | undefined) ?? payroll?.[f] ?? 0])),
      } as PayrollCosts;
      if (cpfFollowingSalary !== undefined) after.cpf = cpfFollowingSalary;
      const itemised = totalEmploymentCostOf({ ...after, otherStatutoryCosts: 0 });
      if (itemised > total + 0.01) {
        result.warnings.push(`Total Employment Cost ${total} is less than salary + CPF + levy + SDL + WICA + insurance (${itemised}); Other Statutory Costs will be 0`);
      }
    }

    if (due && !result.changes.length) {
      result.status = "skipped";
      result.reason = "same as the current figures, nothing to change";
      continue;
    }

    if (opts.dryRun) continue;
    const remarks = r.remarks ? r.remarks.toString().trim() || null : null;
    if (salary !== undefined) {
      await recordSalaryChange(match.id, salary, effectiveDate, { userId: opts.userId, remarks, replacePending: "sameDate", source: "import" });
    }
    await recordCostChange(match.id, values, effectiveDate, { userId: opts.userId, remarks, source: "import" });
  }

  const count = (s: CostImportResult["status"]) => results.filter((r) => r.status === s).length;
  return { results, now: count("now"), scheduled: count("scheduled"), skipped: count("skipped") };
}
