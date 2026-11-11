import { redirect } from "next/navigation";

export default async function HelpArticle({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/help#${slug}`);
}
