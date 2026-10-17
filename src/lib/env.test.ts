import { afterEach, describe, expect, it } from "vitest";
import { appUrl, mainSiteUrl, rawAppUrl, telegramBotToken, trustProxy } from "./env";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("env", () => {
  it("APP_URL: one default, no trailing slash, read on every call", () => {
    delete process.env.APP_URL;
    expect(appUrl()).toBe("http://localhost:3000");
    expect(rawAppUrl()).toBeUndefined();
    process.env.APP_URL = " https://crm.example.uz// ";
    expect(appUrl()).toBe("https://crm.example.uz");
  });

  it("blank values count as unset; tokens are trimmed", () => {
    process.env.TELEGRAM_BOT_TOKEN = "  ";
    expect(telegramBotToken()).toBeUndefined();
    process.env.TELEGRAM_BOT_TOKEN = " 123:abc ";
    expect(telegramBotToken()).toBe("123:abc");
    process.env.MAIN_SITE_URL = "https://site.uz/";
    expect(mainSiteUrl()).toBe("https://site.uz");
  });

  it("TRUST_PROXY only with the exact string true", () => {
    process.env.TRUST_PROXY = "1";
    expect(trustProxy()).toBe(false);
    process.env.TRUST_PROXY = "true";
    expect(trustProxy()).toBe(true);
  });
});
