import { afterEach, describe, expect, it } from "vitest";
import { demoHref, demoMode, signupClosed, signupHref } from "./brand";
import { assertNotDemo } from "@/lib/demo-guard";
import { UserError } from "@/lib/user-error";

const saved = { ...process.env };
afterEach(() => {
  for (const k of ["DEMO_MODE", "DEMO_URL", "MAIN_SITE_URL"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("demo switches", () => {
  it("demo mode is off unless DEMO_MODE is exactly true", () => {
    delete process.env.DEMO_MODE;
    expect(demoMode()).toBe(false);
    process.env.DEMO_MODE = "1";
    expect(demoMode()).toBe(false);
    process.env.DEMO_MODE = "true";
    expect(demoMode()).toBe(true);
  });

  it("landing demo link: DEMO_URL wins, else /demo on a demo server, else hidden", () => {
    delete process.env.DEMO_MODE;
    delete process.env.DEMO_URL;
    expect(demoHref()).toBeNull();
    process.env.DEMO_MODE = "true";
    expect(demoHref()).toBe("/demo");
    process.env.DEMO_URL = " https://demo.example.uz/demo ";
    expect(demoHref()).toBe("https://demo.example.uz/demo");
  });

  it("signup link points at the main site from a demo server", () => {
    delete process.env.MAIN_SITE_URL;
    expect(signupHref()).toBe("/signup");
    process.env.MAIN_SITE_URL = "https://crm.example.uz/";
    expect(signupHref()).toBe("https://crm.example.uz/signup");
  });

  it("signup is closed only on a demo server with no main site", () => {
    delete process.env.DEMO_MODE;
    delete process.env.MAIN_SITE_URL;
    expect(signupClosed()).toBe(false);
    process.env.DEMO_MODE = "true";
    expect(signupClosed()).toBe(true);
    process.env.MAIN_SITE_URL = "https://crm.example.uz";
    expect(signupClosed()).toBe(false);
  });

  it("guarded actions throw a translated error only in demo mode", () => {
    delete process.env.DEMO_MODE;
    expect(() => assertNotDemo()).not.toThrow();
    process.env.DEMO_MODE = "true";
    expect(() => assertNotDemo()).toThrow(UserError);
  });
});
