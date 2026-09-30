import { Router, type IRouter } from "express";

const router: IRouter = Router();
function dataUnavailable(message: string) {
  return { error: { code: "DATA_UNAVAILABLE", message } };
}

// Phase 1 deliberately exposes no fabricated data. Ingestion/query services are added in a later phase.
router.get("/v1/instruments/:symbol", (_req, res) => res.status(503).json(dataUnavailable("Instrument data is not available until a configured provider has been ingested.")));
router.get("/v1/instruments/:symbol/filings", (_req, res) => res.status(503).json(dataUnavailable("SEC filings are not available until they have been ingested.")));
router.get("/v1/instruments/:symbol/fundamentals", (_req, res) => res.status(503).json(dataUnavailable("Fundamentals are not available until they have been ingested.")));

export default router;
