import { connection } from "next/server";
import { proxyMarketData } from "@/lib/market-proxy";

export async function GET() {
  await connection();
  return proxyMarketData("/api/market");
}
