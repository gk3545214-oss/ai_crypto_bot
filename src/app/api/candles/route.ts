import { connection } from "next/server";
import { proxyMarketData } from "@/lib/market-proxy";

export async function GET(request: Request) {
  await connection();
  return proxyMarketData("/api/candles", new URL(request.url).search);
}
