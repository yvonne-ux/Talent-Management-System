import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/errorHandler";
import { requireAuth } from "../../middleware/requireAuth";
import { canViewFinancialsForRequest } from "../../lib/permissions";
import { FINANCIAL_SECTIONS } from "../../lib/changeLog";

export const changesRouter = Router();
changesRouter.use(requireAuth);

function clampInt(raw: unknown, fallback: number, min: number, max: number) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

changesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const days = clampInt(req.query.days, 30, 1, 366);
    const limit = clampInt(req.query.limit, 500, 1, 2000);
    const talentId = req.query.talentId ? Number(req.query.talentId) : undefined;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const canViewFin = await canViewFinancialsForRequest(req);

    const rows = await prisma.changeLog.findMany({
      where: {
        createdAt: { gte: since },
        ...(talentId !== undefined && Number.isFinite(talentId) ? { talentId } : {}),
        ...(canViewFin ? {} : { section: { notIn: FINANCIAL_SECTIONS } }),
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
    });

    res.json(
      rows.map((r) => ({
        id: r.id,
        talentId: r.talentId,
        talentName: r.talentName,
        client: r.clientName,
        section: r.section,
        action: r.action,
        field: r.field,
        from: r.fromValue,
        to: r.toValue,
        source: r.source,
        by: r.userName,
        at: r.createdAt,
      }))
    );
  })
);
