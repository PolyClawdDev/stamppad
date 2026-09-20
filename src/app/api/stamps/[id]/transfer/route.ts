import { fail, ok } from "@/lib/http";
import { submitTransfer, transferChallenge } from "@/lib/market";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const to = new URL(request.url).searchParams.get("to");
  if (!to) return fail("to is required.");
  try {
    return ok(await transferChallenge({ stampId: id, toAddress: to }));
  } catch (error) {
    return fail(error instanceof Error ? error.message : "transfer challenge failed");
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = (await request.json()) as {
      toAddress?: string;
      signatureHex?: string;
      publicKeyHex?: string;
    };
    if (!body.toAddress || !body.signatureHex || !body.publicKeyHex) {
      return fail("toAddress, signatureHex, and publicKeyHex are required.");
    }
    return ok(
      await submitTransfer({
        stampId: id,
        toAddress: body.toAddress,
        signatureHex: body.signatureHex,
        publicKeyHex: body.publicKeyHex,
      }),
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : "transfer failed");
  }
}
