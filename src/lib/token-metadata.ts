import { definedLinks, type LaunchLinks } from "./links";
import type { LaunchRow } from "./store/types";

/**
 * The JSON a Token-2022 mint's URI has to keep serving. Explorers and the
 * venue read this object, not the on-chain name alone.
 */
export function tokenMetadataJson(
  launch: Pick<LaunchRow, "mint" | "name" | "symbol" | "description" | "imageDataUrl"> & LaunchLinks,
  appOrigin: string,
) {
  const links = definedLinks(launch);
  const origin = appOrigin.replace(/\/$/, "");
  return {
    name: launch.name,
    symbol: launch.symbol,
    description: launch.description,
    image: launch.imageDataUrl ?? undefined,
    external_url: links.website ?? (origin ? `${origin}/launches/${launch.mint}` : undefined),
    properties: Object.keys(links).length ? { links } : undefined,
    extensions: Object.keys(links).length ? links : undefined,
  };
}

export function metadataOrigin(): string {
  return (process.env.STAMP_METADATA_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
}
