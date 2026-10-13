# Forex streaming setup

Forex mode exposes only the supported currency-pair selector. The data source
is intentionally internal to the application, so users do not choose or see a
Forex venue.

The application uses Finnhub's browser WebSocket stream:

```text
wss://ws.finnhub.io?token=YOUR_FINNHUB_API_KEY
```

Set the key in `.env.local`:

```bash
NEXT_PUBLIC_FINNHUB_API_KEY=...
```

Finnhub subscriptions use its OANDA symbol namespace internally, for example:

```json
{"type":"subscribe","symbol":"OANDA:EUR_USD"}
```

Available pairs:

- EUR/USD
- GBP/USD
- USD/JPY
- AUD/USD
- USD/CAD

The stream is normalized into the same trade and quote structures used by the
crypto adapters, so the footprint, traded-volume heatmap, volume profile, OBI,
order book, and volatility panels use the same analytics pipeline.

Forex is considered open from Sunday 17:00 through Friday 17:00 in New York
time. Outside that window the application displays `MARKET CLOSED 🚫` and does
not feed stale quotes into analytics.
