import { Router, type IRouter } from "express";
import { HealthCheck200Response } from "@ump/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheck200Response.parse({ status: "ok" });
  res.json(data);
});

export default router;
