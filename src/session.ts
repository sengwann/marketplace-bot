import { prisma } from "./db";
import type { MySession } from "./types";

// Sessions live in Postgres so a half-filled sell form survives deploys/restarts.
// An expired row is deleted the next time it is read; startup also clears old ones.

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

export const sessionStore = {
  async get(key: string): Promise<MySession | undefined> {
    const row = await prisma.botSession.findUnique({ where: { key } });
    if (!row) return undefined;

    if (row.expiresAt < new Date()) {
      await prisma.botSession.deleteMany({ where: { key } });
      return undefined;
    }
    return row.data as unknown as MySession;
  },

  async set(key: string, value: MySession): Promise<void> {
    const data = JSON.parse(JSON.stringify(value ?? {}));
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await prisma.botSession.upsert({
      where: { key },
      update: { data, expiresAt },
      create: { key, data, expiresAt },
    });
  },

  async delete(key: string): Promise<void> {
    await prisma.botSession.deleteMany({ where: { key } });
  },
};

export async function deleteExpiredSessions(): Promise<number> {
  const result = await prisma.botSession.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
