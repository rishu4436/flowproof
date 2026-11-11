import { notFound } from "next/navigation";
import { Studio } from "@/components/studio";
import { getWorkflow } from "@/server/workflows";

export const dynamic = "force-dynamic";

export default async function WorkflowStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const workflow = await getWorkflow(id);
    return <Studio workflow={JSON.parse(JSON.stringify(workflow))} />;
  } catch {
    notFound();
  }
}
