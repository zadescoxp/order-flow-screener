# Forex streaming setup

Forex is selected from the **Asset class** control in the terminal. The same
footprint, traded-volume heatmap, volume profile, OBI, order book, and
volatility pipeline is used for Forex and crypto after each adapter normalizes
its quote stream.

## Providers

| Provider | Venue | Environment | Symbol format |
| --- | --- | --- | --- |
| Massive.com | Massive | `NEXT_PUBLIC_MASSIVE_API_KEY` | `EUR/USD` |
| Finnhub | Finnhub | `NEXT_PUBLIC_FINNHUB_API_KEY` | `EUR/USD` |
| MT5 bridge | MT5 bridge | optional `NEXT_PUBLIC_MT5_WS_URL` | `EUR/USD` |

The browser streams are `wss://socket.massive.com/forex`,
`wss://ws.finnhub.io?token=...`, and the local MT5 bridge URL respectively.

Copy the required variables into `.env.local` before starting Next.js:

```bash
NEXT_PUBLIC_MASSIVE_API_KEY=...
NEXT_PUBLIC_FINNHUB_API_KEY=...
NEXT_PUBLIC_MT5_WS_URL=ws://127.0.0.1:8765
```

The direct browser adapters use `NEXT_PUBLIC_*` variables because the streams
are opened by the client. Only use provider keys that are intended for
browser-side streaming, or place a provider-specific proxy in front of the
application when the provider requires a secret credential.

The MT5 bridge must accept:

```json
{"action":"subscribe","symbol":"EURUSD"}
```

and emit quote messages containing `bid` and `ask` (or `price`), with optional
`volume` and `timestamp` fields.

Forex is considered open from Sunday 17:00 through Friday 17:00 in New York
time. Outside that window the selected adapter publishes
`stateFlag: "MARKET CLOSED 🚫"` and does not feed stale quotes into analytics.
