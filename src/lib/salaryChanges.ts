import { prisma } from "./prisma";
import { logChanges } from "./changeLog";

const CPF_RATE = 0.17;

export function fmtEffectiveDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Singapore" });
}

/** CPF follows the salary only when it was the automatic 17% of the old salary; a CPF figure
 * that came from a payroll sheet (or was typed in) is left alone. */
export function cpfAfterSalaryChange(cpf: number, fromSalary: number, toSalary: number): number {
  if (cpf > 0 && cpf === Math.round(fromSalary * CPF_RATE)) return Math.round(toSalary * CPF_RATE);
  return cpf;
}

async function writeSalaryToPayroll(talentId: number, toSalary: number) {
  const payroll = await prisma.payroll.findUnique({ where: { talentId } });
  if (!payroll) {
    await prisma.payroll.create({ data: { talentId, salary: toSalary } });
    return;
  }
  await prisma.payroll.update({
    where: { talentId },
    data: { salary: toSalary, cpf: cpfAfterSalaryChange(payroll.cpf, payroll.salary, toSalary) },
  });
}

/** The effective date of a salary change already in effect that is dated after `effectiveDate`.
 * A back-dated change older than that is kept as history but must not overwrite the newer salary. */
export async function laterAppliedSalaryDate(talentId: number, effectiveDate: Date): Promise<Date | null> {
  const later = await prisma.salaryChange.findFirst({
    where: { talentId, appliedAt: { not: null }, effectiveDate: { gt: effectiveDate } },
    orderBy: { effectiveDate: "desc" },
  });
  return later?.effectiveDate ?? null;
}

/** Records a salary change. Dated today or earlier, it updates Payroll.salary straight away
 * (unless a later-dated change is already in effect, in which case it is kept as history only);
 * dated in the future, it waits until applyDueSalaryChanges() picks it up on that date.
 * By default a newer pending change replaces any older one that hasn't taken effect yet; the
 * cost-change import passes replacePending "sameDate" so several dated increments can queue up. */
export async function recordSalaryChange(
  talentId: number,
  toSalary: number,
  effectiveDate: Date,
  opts: { userId?: string; remarks?: string | null; replacePending?: "all" | "sameDate"; source?: "manual" | "import" } = {}
) {
  const payroll = await prisma.payroll.findUnique({ where: { talentId } });
  const fromSalary = payroll?.salary ?? null;
  const due = effectiveDate.getTime() <= Date.now();
  const superseded = due && (await laterAppliedSalaryDate(talentId, effectiveDate)) !== null;

  await prisma.salaryChange.deleteMany({
    where: opts.replacePending === "sameDate" ? { talentId, appliedAt: null, effectiveDate } : { talentId, appliedAt: null },
  });
  await prisma.salaryChange.create({
    data: {
      talentId,
      // A history-only (back-dated) change didn't replace today's salary, so it has no "from".
      fromSalary: superseded ? null : fromSalary,
      toSalary,
      effectiveDate,
      appliedAt: due ? new Date() : null,
      remarks: opts.remarks ?? null,
      userId: opts.userId ?? null,
    },
  });
  if (due && !superseded) await writeSalaryToPayroll(talentId, toSalary);

  await logChanges(
    talentId,
    "payroll",
    [{
      field: `Salary (effective ${fmtEffectiveDate(effectiveDate)}${superseded ? ", history only: a later change is in effect" : ""})`,
      fromValue: fromSalary === null ? null : String(fromSalary),
      toValue: String(toSalary),
    }],
    { userId: opts.userId, source: opts.source }
  );
}

/** Copies every pending salary change whose effective date has arrived onto Payroll.salary.
 * Called before talent data is read, so nothing needs to run on a schedule. */
export async function applyDueSalaryChanges() {
  const due = await prisma.salaryChange.findMany({
    where: { appliedAt: null, effectiveDate: { lte: new Date() } },
    orderBy: { effectiveDate: "asc" },
  });
  for (const change of due) {
    await writeSalaryToPayroll(change.talentId, change.toSalary);
    await prisma.salaryChange.update({ where: { id: change.id }, data: { appliedAt: new Date() } });
  }
}
