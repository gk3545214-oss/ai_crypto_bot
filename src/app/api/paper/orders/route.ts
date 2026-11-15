import { connection } from "next/server";
import { proxyPaper } from "@/lib/paper-proxy";

export async function POST(request: Request) {
  await connection();
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const urlOrigin = new URL(request.url).origin;
  const allowedOrigins = new Set([urlOrigin]);
  if (host) {
    allowedOrigins.add(`http://${host}`);
    allowedOrigins.add(`https://${host}`);
  }
  if (!origin || !allowedOrigins.has(origin)) {
    return Response.json({ error: "Paper orders require a same-origin request." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Paper orders require JSON." }, { status: 415 });
  }
  return proxyPaper("/api/paper/orders", await request.text());
}
