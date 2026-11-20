// HTX public REST calls the browser cannot make itself (HTX sends no CORS
// headers). Strictly allowlisted USDT-margined swap data; no credentials.
//
//   GET /api/htx?op=contract&contract=BTC-USDT  → contract size
//   GET /api/htx?op=oi&contract=BTC-USDT        → open interest
//   GET /api/htx?op=funding&contract=BTC-USDT   → funding rate and next funding time

import type { NextRequest } from "next/server";

const BASE = "https://api.hbdm.com/linear-swap-api/v1";
const OPS: Record<string, string> = {
  contract: "swap_contract_info",
  oi: "swap_open_interest",
  funding: "swap_funding_rate",
};
const CONTRACT = /^[A-Z0-9]{1,20}-USDT$/;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const path = OPS[searchParams.get("op") ?? ""];
  const contract = searchParams.get("contract") ?? "";
  if (!path || !CONTRACT.test(contract)) return Response.json({ error: "Unsupported request" }, { status: 400 });
  try {
    const upstream = await fetch(`${BASE}/${path}?contract_code=${contract}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    return new Response(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "HTX is unreachable" }, { status: 502 });
  }
}
