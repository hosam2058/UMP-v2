import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig, requirePersistenceConfig } from "./config";
import { ProviderError } from "./providers/contracts";

test("base configuration permits health-only startup without DATABASE_URL", () => {
  const config = loadConfig({});

  assert.equal(config.databaseUrl, undefined);
  assert.equal(config.marketDataProvider, "none");
});

test("persistence configuration rejects absent or blank DATABASE_URL without leaking secrets", () => {
  for (const databaseUrl of [undefined, "   "]) {
    const config = loadConfig({ DATABASE_URL: databaseUrl });

    assert.throws(
      () => requirePersistenceConfig(config),
      (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.code, "CONFIGURATION");
        assert.match(error.message, /DATABASE_URL is required/);
        assert.doesNotMatch(error.message, /postgres|password|secret/i);
        return true;
      },
    );
  }
});

test("persistence configuration returns a validated non-empty database URL", () => {
  const databaseUrl = "postgres://test-user:secret@localhost/test";
  const persistence = requirePersistenceConfig(loadConfig({ DATABASE_URL: databaseUrl }));

  assert.equal(persistence.databaseUrl, databaseUrl);
});
