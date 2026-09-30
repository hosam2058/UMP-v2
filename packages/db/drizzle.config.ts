import { defineConfig } from "drizzle-kit";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for Drizzle tooling");
}

export default defineConfig({
  schema: resolve(__dirname, "src", "schema", "index.ts"),
  out: resolve(__dirname, "drizzle"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
