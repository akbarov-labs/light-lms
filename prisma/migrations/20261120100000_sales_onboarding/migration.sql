-- Center setup in the bot chat: status, draft and file ids (src/lib/sales-agent/onboarding.ts)
ALTER TABLE "SalesChat" ADD COLUMN "onboarding" JSONB NOT NULL DEFAULT '{}';
