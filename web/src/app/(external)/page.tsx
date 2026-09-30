import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard/ledger");
  return <>Coming Soon</>;
}
