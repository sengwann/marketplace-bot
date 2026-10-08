import "dotenv/config";
import { defineConfig } from "prisma/config";

// Migrations need a connection that supports "session" features. With Supabase use the
// SESSION pooler string (port 5432) from the Connect page; the transaction pooler
// (port 6543) does not work for migrations. DATABASE_URL is used unless DIRECT_URL is set.
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!url) {
  throw new Error("Set DATABASE_URL (and optionally DIRECT_URL) before running Prisma.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url },
});
