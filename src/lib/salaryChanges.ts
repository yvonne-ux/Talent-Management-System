import { prisma } from "./prisma";
import { logChanges } from "./changeLog";

const CPF_RATE = 0.17;

export function fmtEffectiveDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** CPF follows the salary only when it was the automatic 17% of the old salary; a CPF figure
 * that came from a payroll sheet (or was typed in) is left alone. */
function cpfAfterSalaryChange(cpf: number, fromSalary: number, toSalary: number): number {
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

/** Records a salary change. Dated today or earlier, it updates Payroll.salary straight away;
 * dated in the future, it waits until applyDueSalaryChanges() picks it up on that date.
 * A newer pending change replaces an older one that hasn't taken effect yet. */
export async function recordSalaryChange(
  talentId: number,
  toSalary: number,
  effectiveDate: Date,
  opts: { userId?: string; remarks?: string | null } = {}
) {
  const payroll = await prisma.payroll.findUnique({ where: { talentId } });
  const fromSalary = payroll?.salary ?? null;
  const due = effectiveDate.getTime() <= Date.now();

  await prisma.salaryChange.deleteMany({ where: { talentId, appliedAt: null } });
  await prisma.salaryChange.create({
    data: {
      talentId,
      fromSalary,
      toSalary,
      effectiveDate,
      appliedAt: due ? new Date() : null,
      remarks: opts.remarks ?? null,
      userId: opts.userId ?? null,
    },
  });
  if (due) await writeSalaryToPayroll(talentId, toSalary);

  await logChanges(
    talentId,
    "payroll",
    [{
      field: `Salary (effective ${fmtEffectiveDate(effectiveDate)})`,
      fromValue: fromSalary === null ? null : String(fromSalary),
      toValue: String(toSalary),
    }],
    { userId: opts.userId }
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
