import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/errorHandler";
import { requireAuth } from "../../middleware/requireAuth";
import { daysLeft, totalEmployerCost, talentRevenue, isContractClosed, isPassClosed } from "../../lib/computed";
import { RENEWAL_THRESHOLDS } from "../../config/businessRules";
import { talentInclude } from "../talents/serialize";
import { canViewFinancialsForRequest } from "../../lib/permissions";
import { applyDueChanges } from "../../lib/costChanges";
import { applyAutoTalentStatuses } from "../../lib/talentStatus";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get(
  "/home",
  asyncHandler(async (req, res) => {
    const today = new Date();
    await applyDueChanges();
    await applyAutoTalentStatuses();
    const talents = await prisma.talent.findMany({ where: { active: true }, include: talentInclude });

    let pendingStart = 0;
    let onNotice = 0;
    let expiredContracts = 0;
    let closedContracts = 0;
    let expiringWorkPasses = 0;
    let expiringContracts = 0;
    let monthlyRevenue = 0;
    let monthlyCost = 0;

    for (const t of talents) {
      // Closed contracts/passes (Inactive, Offboarded, On Bench, Contract Ended, pass Cancelled) are not counted as expiring.
      const contractClosed = isContractClosed(t.talentStatus, t.contract?.contractStatus, t.contract?.contractLifecycleStatus);
      const passClosed = isPassClosed(t.talentStatus, t.workPass?.passStatus, t.workPass?.passLifecycleStatus);
      const contractDaysLeftValue = t.contract ? daysLeft(t.contract.contractEnd, today) : null;
      const passDaysLeftValue = t.workPass && !passClosed ? daysLeft(t.workPass.passExpiry, today) : null;

      if (contractClosed) {
        closedContracts++;
      } else {
        if (t.contract && t.contract.contractStart > today) pendingStart++;
        if (contractDaysLeftValue !== null && contractDaysLeftValue >= 0 && contractDaysLeftValue <= 30) onNotice++;
        if (contractDaysLeftValue !== null && contractDaysLeftValue < 0) expiredContracts++;
        if (contractDaysLeftValue !== null && contractDaysLeftValue >= 0 && contractDaysLeftValue <= RENEWAL_THRESHOLDS.homeDashboardExpiringDays) expiringContracts++;
      }
      if (passDaysLeftValue !== null && passDaysLeftValue >= 0 && passDaysLeftValue <= RENEWAL_THRESHOLDS.homeDashboardExpiringDays) expiringWorkPasses++;

      // Inactive and Offboarded talents are neither paid nor billed; On Bench talents are paid but not billed.
      if (t.payroll && t.talentBilling && t.workPass && t.talentStatus !== "Offboarded" && t.talentStatus !== "Inactive") {
        if (t.talentStatus !== "On Bench") monthlyRevenue += talentRevenue(t.talentBilling.chargeRate, t.talentBilling.billingType);
        monthlyCost += totalEmployerCost(t.payroll, t.workPass.workPassType, t.contract?.contractStart, today);
      }
    }

    const [pendingSow, pendingPo, pendingInvoices, pendingTimesheets] = await Promise.all([
      prisma.sowRecord.count({ where: { sowRequired: true, sowStatus: { notIn: ["Completed", "N/A"] } } }),
      prisma.poRecord.count({ where: { poRequired: true, poStatus: { notIn: ["Completed", "N/A"] } } }),
      prisma.talentBilling.count({ where: { invoiceStatus: { not: "Paid" } } }),
      prisma.leaveTimesheet.count({ where: { timesheetSubmitted: false } }),
    ]);

    const canViewFin = await canViewFinancialsForRequest(req);

    res.json({
      totalActiveTalents: talents.length - pendingStart - expiredContracts - closedContracts,
      pendingStart,
      onNotice,
      expiredContracts,
      expiringWorkPasses,
      expiringContracts,
      pendingSow,
      pendingPo,
      pendingInvoices,
      pendingTimesheets,
      monthlyRevenue: canViewFin ? monthlyRevenue : null,
      monthlyCost: canViewFin ? monthlyCost : null,
      monthlyGrossProfit: canViewFin ? monthlyRevenue - monthlyCost : null,
      // Trend vs prior period intentionally omitted — no fake history; real trend data
      // becomes available once monthly snapshots (Phase 5) have accumulated real history.
    });
  })
);

/* Talents Overview month-on-month change. The page computes its counts with the same rules it
   displays them with, saves them once a day here, and compares against the latest day saved on
   or before the same date last month. */
const SNAPSHOT_KEYS = ["active", "total", "pendingStart", "noticePeriod", "expiringContracts", "expiringPasses", "payroll"];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

dashboardRouter.put(
  "/talent-stats/:day",
  asyncHandler(async (req, res) => {
    const day = String(req.params.day);
    if (!DAY_RE.test(day)) return res.status(400).json({ error: "day must be YYYY-MM-DD" });
    const stats: Record<string, number> = {};
    for (const key of SNAPSHOT_KEYS) {
      const value = Number(req.body?.[key]);
      if (!Number.isFinite(value)) return res.status(400).json({ error: `${key} must be a number` });
      stats[key] = value;
    }
    await prisma.talentStatsSnapshot.upsert({ where: { day }, create: { day, stats }, update: { stats } });
    res.json({ ok: true });
  })
);

dashboardRouter.get(
  "/talent-stats/on-or-before/:day",
  asyncHandler(async (req, res) => {
    const day = String(req.params.day);
    if (!DAY_RE.test(day)) return res.status(400).json({ error: "day must be YYYY-MM-DD" });
    const snapshot = await prisma.talentStatsSnapshot.findFirst({ where: { day: { lte: day } }, orderBy: { day: "desc" } });
    res.json(snapshot ? { day: snapshot.day, stats: snapshot.stats } : null);
  })
);
