-- AI agent follow-up (phase 1.1). Prisma's generated DROP INDEX lines for the raw trigram / partial
-- indexes were removed by hand: those indexes are created in raw SQL and are not in schema.prisma.

-- A Telegram AI lead exists from the person's first message, before (or without) a phone number.
ALTER TABLE "Lead" ALTER COLUMN "phone" DROP NOT NULL;

-- Staff can write to the person directly when they have a Telegram @username.
ALTER TABLE "AgentChat" ADD COLUMN "username" TEXT;

-- Branch map point for the agent's "send location".
ALTER TABLE "Branch" ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION;

-- Public teacher text (experience, results): the only profile field the agent may show customers.
ALTER TABLE "User" ADD COLUMN "bio" TEXT;
