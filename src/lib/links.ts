/**
 * Optional project links written into a launch's permanent token metadata.
 * Empty is fine. Anything supplied has to be a real https address, because the
 * URI is published and cannot be edited after the mint exists.
 */

export const LINK_MAX = 200;

export interface LaunchLinks {
  website: string;
  twitter: string;
  telegram: string;
}

export const EMPTY_LAUNCH_LINKS: LaunchLinks = {
  website: "",
  twitter: "",
  telegram: "",
};

const HANDLE = /^[A-Za-z0-9_]{1,32}$/;

export function parseLaunchLinks(input: {
  website?: string | null;
  twitter?: string | null;
  telegram?: string | null;
}): LaunchLinks {
  return {
    website: normalizeWebsite(input.website),
    twitter: normalizeTwitter(input.twitter),
    telegram: normalizeTelegram(input.telegram),
  };
}

export function launchLinksProblem(links: LaunchLinks): string | null {
  if (links.website && !httpsUrl(links.website)) {
    return "Website must be an https address, or left blank.";
  }
  if (links.twitter && !isTwitter(links.twitter)) {
    return "X / Twitter must be an x.com or twitter.com address, an @handle, or left blank.";
  }
  if (links.telegram && !isTelegram(links.telegram)) {
    return "Telegram must be a t.me address, an @handle, or left blank.";
  }
  return null;
}

export function definedLinks(links: LaunchLinks): Partial<LaunchLinks> {
  return {
    ...(links.website ? { website: links.website } : {}),
    ...(links.twitter ? { twitter: links.twitter } : {}),
    ...(links.telegram ? { telegram: links.telegram } : {}),
  };
}

function normalizeWebsite(raw: string | null | undefined): string {
  const value = trimLink(raw);
  if (!value) return "";
  const url = httpsUrl(value.includes("://") ? value : `https://${value}`);
  return url ? url.toString().replace(/\/$/, "") : value;
}

function normalizeTwitter(raw: string | null | undefined): string {
  const value = trimLink(raw);
  if (!value) return "";
  const handle = asHandle(value);
  if (handle) return `https://x.com/${handle}`;
  const url = httpsUrl(value);
  if (!url) return value;
  if (url.hostname === "twitter.com" || url.hostname === "www.twitter.com") {
    url.hostname = "x.com";
  }
  return url.toString().replace(/\/$/, "");
}

function normalizeTelegram(raw: string | null | undefined): string {
  const value = trimLink(raw);
  if (!value) return "";
  const handle = asHandle(value);
  if (handle) return `https://t.me/${handle}`;
  const url = httpsUrl(value);
  return url ? url.toString().replace(/\/$/, "") : value;
}

function trimLink(raw: string | null | undefined): string {
  return (raw ?? "").trim().slice(0, LINK_MAX);
}

function asHandle(raw: string): string | null {
  if (raw.includes("/") || raw.includes(".")) return null;
  const handle = raw.replace(/^@/, "");
  return HANDLE.test(handle) ? handle : null;
}

function httpsUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url;
  } catch {
    return null;
  }
}

function isTwitter(value: string): boolean {
  const url = httpsUrl(value);
  return Boolean(url && (url.hostname === "x.com" || url.hostname === "www.x.com" || url.hostname === "twitter.com" || url.hostname === "www.twitter.com") && url.pathname.length > 1);
}

function isTelegram(value: string): boolean {
  const url = httpsUrl(value);
  return Boolean(url && (url.hostname === "t.me" || url.hostname === "www.t.me") && url.pathname.length > 1);
}
