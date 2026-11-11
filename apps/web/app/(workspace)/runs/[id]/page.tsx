import { notFound } from "next/navigation";
import { Console } from "@/components/console";
import { getRun } from "@/server/runs";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === "compare") return null;
  try {
    const run = await getRun(id);
    return <Console initial={JSON.parse(JSON.stringify(run))} />;
  } catch {
    notFound();
  }
}
