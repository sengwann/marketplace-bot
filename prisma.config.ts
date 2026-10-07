import "dotenv/config";
import { defineConfig } from "prisma/config";

// Migrations need a DIRECT database connection (Neon: the host WITHOUT "-pooler").
// If you give the bot a pooled DATABASE_URL, also set DIRECT_URL to the direct one.
// Otherwise DATABASE_URL is used for both.
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!url) {
  throw new Error("Set DATABASE_URL (and optionally DIRECT_URL) before running Prisma.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url },
});
