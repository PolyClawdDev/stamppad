import { describe, expect, it } from "vitest";
import { launchLinksProblem, parseLaunchLinks } from "../src/lib/links";
import { tokenMetadataJson } from "../src/lib/token-metadata";

describe("launch project links", () => {
  it("leaves blanks empty", () => {
    expect(parseLaunchLinks({})).toEqual({ website: "", twitter: "", telegram: "" });
    expect(launchLinksProblem(parseLaunchLinks({}))).toBeNull();
  });

  it("accepts a website, an X handle, and a Telegram handle", () => {
    const links = parseLaunchLinks({
      website: "stamppad.fun",
      twitter: "@stamppad",
      telegram: "stamppad",
    });
    expect(links).toEqual({
      website: "https://stamppad.fun",
      twitter: "https://x.com/stamppad",
      telegram: "https://t.me/stamppad",
    });
    expect(launchLinksProblem(links)).toBeNull();
  });

  it("rewrites twitter.com to x.com and keeps full addresses", () => {
    const links = parseLaunchLinks({
      website: "https://stamppad.fun/docs",
      twitter: "https://twitter.com/stamppad",
      telegram: "https://t.me/stamppad",
    });
    expect(links.twitter).toBe("https://x.com/stamppad");
    expect(links.website).toBe("https://stamppad.fun/docs");
    expect(launchLinksProblem(links)).toBeNull();
  });

  it("rejects javascript and other non-https schemes", () => {
    expect(launchLinksProblem(parseLaunchLinks({ website: "javascript:alert(1)" }))).toMatch(/https/);
    expect(launchLinksProblem(parseLaunchLinks({ twitter: "https://evil.example/x" }))).toMatch(/X/);
    expect(launchLinksProblem(parseLaunchLinks({ telegram: "https://example.com/t" }))).toMatch(/Telegram/);
  });

  it("writes the links into the permanent metadata JSON", () => {
    const json = tokenMetadataJson(
      {
        mint: "Mint111111111111111111111111111111111111111",
        name: "Stamp",
        symbol: "STMP",
        description: "A stamp",
        imageDataUrl: null,
        website: "https://stamppad.fun",
        twitter: "https://x.com/stamppad",
        telegram: "",
      },
      "https://stamppad.fun",
    );
    expect(json.external_url).toBe("https://stamppad.fun");
    expect(json.properties).toEqual({
      links: { website: "https://stamppad.fun", twitter: "https://x.com/stamppad" },
    });
    expect(json.extensions).toEqual({
      website: "https://stamppad.fun",
      twitter: "https://x.com/stamppad",
    });
  });

  it("falls back to the launch page when no website was given", () => {
    const json = tokenMetadataJson(
      {
        mint: "Mint111111111111111111111111111111111111111",
        name: "Stamp",
        symbol: "STMP",
        description: "",
        imageDataUrl: null,
        website: "",
        twitter: "",
        telegram: "",
      },
      "https://stamppad.fun",
    );
    expect(json.external_url).toBe("https://stamppad.fun/launches/Mint111111111111111111111111111111111111111");
    expect(json.properties).toBeUndefined();
  });
});
