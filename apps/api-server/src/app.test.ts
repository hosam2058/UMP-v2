import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import {
  GetInstrument503Response,
  GetInstrumentFilings503Response,
  GetInstrumentFundamentals503Response,
} from "@ump/api-zod";
import { createApp } from "./app";
import { loadConfig } from "./config";

test("health-only HTTP surface works without persistence configuration", async () => {
  assert.equal(loadConfig({}).databaseUrl, undefined);

  const server = createServer(createApp());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}/api`;

    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });

    for (const [path, schema] of [
      ["/v1/instruments/SYNTH", GetInstrument503Response],
      ["/v1/instruments/SYNTH/filings", GetInstrumentFilings503Response],
      [
        "/v1/instruments/SYNTH/fundamentals",
        GetInstrumentFundamentals503Response,
      ],
    ] as const) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 503);
      const body: unknown = await response.json();
      schema.parse(body);
      assert.deepEqual(Object.keys(body as object), ["error"]);
      const error = (body as { error: { code: string; message: string } })
        .error;
      assert.equal(error.code, "DATA_UNAVAILABLE");
      assert.equal(
        error.message,
        "Public financial data access is not activated.",
      );
      assert.doesNotMatch(JSON.stringify(body), /stack|password|DATABASE_URL/i);
      assert.match(
        response.headers.get("content-type") ?? "",
        /application\/json/,
      );
    }

    const absentRoute = await fetch(
      `${baseUrl}/v1/companies/0000000000/fundamentals`,
    );
    assert.equal(absentRoute.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
