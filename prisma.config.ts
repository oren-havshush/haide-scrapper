try {
  // dotenv is an optional dependency at this layer (the runtime Docker images
  // do not install it); fall back silently when it is missing. Require is the
  // simplest way to keep the failure synchronous and recoverable.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv/config");
} catch {
  /* dotenv optional - e.g. when running migrations in minimal Docker image */
}
import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
