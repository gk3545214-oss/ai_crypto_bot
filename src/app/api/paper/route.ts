import { connection } from "next/server";
import { proxyPaper } from "@/lib/paper-proxy";

export async function GET() {
  await connection();
  return proxyPaper("/api/paper");
}
