import { prisma } from "./prisma";
import { logChanges } from "./changeLog";
import { LIFETIME_PASS_TYPES } from "../config/businessRules";

const OVER_CONTRACT_STATUSES = new Set(["Expired", "Contract Ended", "Terminated"]);

type ContractLike = { contractEnd: Date; contractStatus: string } | null | undefined;
type WorkPassLike = { workPassType: string; passStatus: string } | null | undefined;

/** A contract is over once its end date has passed or its status says it has ended. */
export function isContractOver(contract: ContractLike, today: Date = new Date()): boolean {
  if (!contract) return false;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return contract.contractEnd < startOfToday || OVER_CONTRACT_STATUSES.has(contract.contractStatus);
}

export function hasForeignPass(workPass: WorkPassLike): boolean {
  return !!workPass && !!workPass.workPassType && !LIFETIME_PASS_TYPES.has(workPass.workPassType);
}

/** The status a talent on Automatic should have, or null to leave it as it is.
 * - Contract running: Active.
 * - Contract over, foreign pass marked Cancelled (by hand, as a double check): Inactive.
 * - Contract over, foreign pass not cancelled: On Bench (still employed, not on a project).
 * - Contract over, Citizen/PR or no pass: no automatic answer, the user is asked instead. */
export function automaticTalentStatus(contract: ContractLike, workPass: WorkPassLike, today: Date = new Date()): string | null {
  if (!contract) return null;
  if (!isContractOver(contract, today)) return "Active";
  if (!hasForeignPass(workPass)) return null;
  return workPass!.passStatus === "Cancelled" ? "Inactive" : "On Bench";
}

/** Brings every talent on Automatic up to date. Runs lazily on reads, like applyDueChanges(). */
export async function applyAutoTalentStatuses(talentId?: number) {
  const talents = await prisma.talent.findMany({
    where: { talentStatusAuto: true, active: true, ...(talentId !== undefined ? { id: talentId } : {}) },
    select: { id: true, talentStatus: true, contract: { select: { contractEnd: true, contractStatus: true } }, workPass: { select: { workPassType: true, passStatus: true } } },
  });
  for (const t of talents) {
    const next = automaticTalentStatus(t.contract, t.workPass);
    if (!next || next === t.talentStatus) continue;
    await prisma.talent.update({ where: { id: t.id }, data: { talentStatus: next } });
    await logChanges(t.id, "personal", [{ field: "Talent status", fromValue: t.talentStatus, toValue: next }], { source: "auto" });
  }
}
