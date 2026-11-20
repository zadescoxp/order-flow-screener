// KuCoin public REST calls the browser cannot make itself (KuCoin sends no
// CORS headers). Strictly allowlisted: the public WebSocket token and USDT-M
// contract details. No credentials are involved.
//
//   POST /api/kucoin?op=bullet&market=spot|futures  → public WS connection token
//   GET  /api/kucoin?op=contract&symbol=XBTUSDTM      → contract size, OI, funding

import type { NextRequest } from "next/server";

const BULLET: Record<string, string> = {
  spot: "https://api.kucoin.com/api/v1/bullet-public",
  futures: "https://api-futures.kucoin.com/api/v1/bullet-public",
};
const CONTRACT_SYMBOL = /^[A-Z0-9]{2,20}USDTM$/;

async function relay(url: string, init?: RequestInit): Promise<Response> {
  try {
    const upstream = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(8_000) });
    const body = await upstream.text();
    return new Response(body, { status: upstream.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "KuCoin is unreachable" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const url = searchParams.get("op") === "bullet" ? BULLET[searchParams.get("market") ?? ""] : undefined;
  if (!url) return Response.json({ error: "Unsupported request" }, { status: 400 });
  return relay(url, { method: "POST" });
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbol = searchParams.get("symbol") ?? "";
  if (searchParams.get("op") !== "contract" || !CONTRACT_SYMBOL.test(symbol)) {
    return Response.json({ error: "Unsupported request" }, { status: 400 });
  }
  return relay(`https://api-futures.kucoin.com/api/v1/contracts/${symbol}`);
}
