export async function proxyMarketData(path: "/api/market" | "/api/candles", query = "") {
  try {
    const baseUrl = process.env.FASTAPI_BASE_URL ?? "http://127.0.0.1:8000";
    const response = await fetch(new URL(`${path}${query}`, baseUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const body: unknown = await response.json();
    return Response.json(body, {
      status: response.status,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("FastAPI market backend is unavailable", error);
    return Response.json(
      { error: "Market backend is unavailable. Check that the FastAPI service is running." },
      { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
