import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

/**
 * Builds the currently enabled HTTP surface. Persistence is intentionally not
 * part of app construction: health and unavailable-only routes stay usable
 * without DATABASE_URL, and inactive query capabilities cannot open a pool.
 */
export function createApp(): Express {
  const app: Express = express();

  app.use(
    pinoHttp({
      logger,
      customLogLevel(_req, res, error) {
        if (error) return "error";
        if (res.statusCode >= 500) return "warn";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
      customErrorObject(_req, _res, _error, value) {
        const { err: _unsafeError, ...safeValue } = value;
        return { ...safeValue, error: { code: "HTTP_REQUEST_FAILED" } };
      },
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use("/api", router);

  return app;
}

export default createApp();
