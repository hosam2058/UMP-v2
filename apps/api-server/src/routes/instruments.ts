import { Router, type IRouter } from "express";
import {
  GetInstrument503Response,
  GetInstrumentFilings503Response,
  GetInstrumentFundamentals503Response,
} from "@ump/api-zod";

const router: IRouter = Router();
function dataUnavailable(message: string) {
  return { error: { code: "DATA_UNAVAILABLE", message } };
}

// Internal query capabilities exist, but public financial routes are inactive.
const inactiveMessage = "Public financial data access is not activated.";
router.get("/v1/instruments/:symbol", (_req, res) =>
  res
    .status(503)
    .json(GetInstrument503Response.parse(dataUnavailable(inactiveMessage))),
);
router.get("/v1/instruments/:symbol/filings", (_req, res) =>
  res
    .status(503)
    .json(
      GetInstrumentFilings503Response.parse(dataUnavailable(inactiveMessage)),
    ),
);
router.get("/v1/instruments/:symbol/fundamentals", (_req, res) =>
  res
    .status(503)
    .json(
      GetInstrumentFundamentals503Response.parse(
        dataUnavailable(inactiveMessage),
      ),
    ),
);

export default router;
