import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "./generated/prisma/client";
import { logger } from "./logger";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is missing.");
}

// SSL:
//  - DATABASE_CA_CERT set  -> verify the server with that certificate (best)
//  - DATABASE_SSL=true     -> encrypted, but certificate not verified
//  - neither               -> no SSL (fine for Render/Railway internal URLs)
// Supabase: use DATABASE_SSL=true.
function sslConfig() {
  if (process.env.DATABASE_CA_CERT) {
    return {
      rejectUnauthorized: true,
      ca: process.env.DATABASE_CA_CERT.replace(/\\n/g, "\n"),
    };
  }
  if (process.env.DATABASE_SSL === "true") {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

// Supabase: use the "Session pooler" address (port 5432) from the Connect page.
// Render is IPv4 only and Supabase's direct address is IPv6 only, so the direct one fails.
const pool = new Pool({
  connectionString,
  ssl: sslConfig(),
  max: 5,
  // A sleeping database needs a moment to wake up on the first query.
  connectionTimeoutMillis: 15_000,
  idleTimeoutMillis: 30_000,
  keepAlive: true,
});

// Without this handler, a connection that the database drops while idle
// (Neon/Supabase do this when they sleep or restart) would crash the whole bot.
pool.on("error", (err) => {
  logger.warn({ err }, "Idle database connection error (a new one will be opened)");
});

export const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

export async function closeDatabase(): Promise<void> {
  await prisma.$disconnect();
  await pool.end();
}
