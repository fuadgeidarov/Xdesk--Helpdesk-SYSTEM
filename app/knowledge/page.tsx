import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import KnowledgeClient from "./KnowledgeClient";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <KnowledgeClient />;
}
