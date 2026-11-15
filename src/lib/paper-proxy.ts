export async function proxyPaper(path: "/api/paper" | "/api/paper/orders", body?: string) {
  try {
    const baseUrl = process.env.FASTAPI_BASE_URL ?? "http://127.0.0.1:8000";
    const response = await fetch(new URL(path, baseUrl), {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const result: unknown = await response.json();
    return Response.json(result, {
      status: response.status,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("Paper backend request failed", error);
    return Response.json(
      { error: "Paper backend unavailable. If submitting an order, retry the same request." },
      { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
