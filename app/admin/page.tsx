import { redirect } from "next/navigation";
import { getSessionUser, isStaff } from "@/lib/auth";
import UsersClient from "./UsersClient";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isStaff(user.role)) redirect("/tickets");
  return <UsersClient />;
}
