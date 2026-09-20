/**
 * Alias for the older flat stamp URL. The canonical page lives under the
 * collection, so links shared before that change still resolve.
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { Note } from "@/components/ui";
import { getStore } from "@/lib/store";

export default async function StampAliasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const stamp = await getStore().getStamp(id);
  if (stamp) redirect(`/collections/${stamp.mint}/stamps/${stamp.id}`);
  return (
    <Note tone="error" title="Stamp not found">
      No inscription with that identifier exists on this deployment.{" "}
      <Link className="linky" href="/market">
        Back to marketplace
      </Link>
    </Note>
  );
}
