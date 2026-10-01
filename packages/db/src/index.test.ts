import assert from "node:assert/strict";
import test from "node:test";
import { companies, createDatabase, fundamentalFacts, instruments, secFilings } from "./index";

test("database package imports without DATABASE_URL and exposes issuer-level SEC schema", () => {
  assert.equal("cik" in instruments, false);
  assert.equal("instrumentId" in fundamentalFacts, false);
  assert.equal("companyId" in fundamentalFacts, true);
  assert.equal("instrumentId" in secFilings, false);
  assert.equal("cik" in secFilings, false);
  assert.equal("companyId" in secFilings, true);
  assert.equal(companies.cik.notNull, false);
});

test("database factory creates isolated lazy pools with explicit shutdown", async () => {
  const connectionString = "postgres://test-user:test-password@127.0.0.1:65432/test";
  const first = createDatabase({ connectionString });
  const second = createDatabase({ connectionString });

  assert.notEqual(first.pool, second.pool);
  assert.equal(first.pool.totalCount, 0);
  assert.equal(second.pool.totalCount, 0);

  await first.close();
  await second.close();

  assert.equal(first.pool.ended, true);
  assert.equal(second.pool.ended, true);
});
