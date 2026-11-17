-- Prompt caching: cached tokens metered apart from uncached input (they cost ~0.1x to read, ~1.25x to write).
ALTER TABLE "AgentChat" ADD COLUMN "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgentUsage" ADD COLUMN "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0;
