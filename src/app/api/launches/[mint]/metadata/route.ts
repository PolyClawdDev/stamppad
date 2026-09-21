/**
 * The token metadata a Token-2022 mint points at.
 *
 * Token-2022 stores only the URI on chain, so this is what explorers and the
 * venue read to learn a launch's name, artwork and description. The URI is
 * written onto the mint at creation and cannot be changed afterwards, which is
 * why this route answers from the recorded launch rather than from anything
 * request-supplied: the address has to keep meaning the same thing.
 *
 * It is not wrapped in the app's ok/fail envelope. Metaplex-shaped consumers
 * expect the object at the top level, so wrapping it would make the metadata
 * unreadable to every one of them.
 */
import { getStore } from "@/lib/store";
import { metadataOrigin, tokenMetadataJson } from "@/lib/token-metadata";

export async function GET(_request: Request, context: { params: Promise<{ mint: string }> }) {
  const { mint } = await context.params;
  const launch = await getStore().getLaunch(mint);
  if (!launch) {
    return Response.json(
      {
        error: "unknown_mint",
        message:
          "No launch is recorded here for that mint. Metadata is served from the recorded launch, so it resolves once the launch has landed and been indexed.",
      },
      { status: 404 },
    );
  }
  return Response.json(tokenMetadataJson(launch, metadataOrigin()), {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
