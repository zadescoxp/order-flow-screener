# Order Flow Tracker

Order Flow Tracker is a real-time market data terminal for studying executed
volume, price distribution, liquidity, and market microstructure. It provides a
compact analytical workspace for crypto markets and selected foreign-exchange
pairs.

The application is an analysis and screening tool. It does not place trades,
manage orders, connect to brokerage accounts, or manage portfolios.

## Overview

The terminal combines live WebSocket market data with a normalized order-flow
engine. Exchange-specific payloads are converted into common trade and order
book structures before they are processed by the charts and analytics panels.

```text
WebSocket feeds
    -> market adapters
    -> normalized market data
    -> order-flow engine
    -> session store
    -> charts and analytics panels
```

## Features

### Indicators

The footprint's **Indicators** menu lets users configure, per browser:

- Session VWAP, optional ±1σ / ±2σ deviation bands, and VWAP colour
- Session POC, value area (60 / 70 / 80 %), session high / low, POC colour
- Imbalance highlighting and ratio (2× – 4×), stacked imbalances and minimum
  levels (2 – 5), candle POC, OHLC strip, summary rows and last-price line

### Footprint chart

- Contiguous tick ladder sized automatically from the instrument price
  (≈1 bp for crypto, ≈1 pip for FX)
- Three cell modes: Bid × Ask, Delta, and Volume
- Per-level imbalance highlighting (≥3× by default) and stacked-imbalance bars
- Per-candle POC outline and OHLC strip
- Session VWAP path, session POC, VAH and VAL lines
- Summary rows: volume, delta, cumulative delta, and trade count
- Session volume profile attached to the same price ladder
- Follow mode for the live candle and last price, drag/wheel pan and zoom
- Device-pixel-ratio aware canvas rendering with synchronized crosshair

### Traded-volume heatmap

- Enabled by default in the Liquidity workspace; toggle it from the footprint header
- Shows the relationship between traded volume and price
- Uses a typed-array time and price grid internally
- Paints incremental updates to an offscreen canvas
- Clips intensity near the upper percentile so one large trade does not
  dominate the entire chart
- Uses the active terminal theme and a low-opacity overlay
- Combines venue data when an aggregate crypto selection is active

The heatmap represents executed volume. It is not a resting-order-book
visualization.

### Session profile and KPI strip

- Buy/sell split volume profile with value area (70%) shading and POC
- Session statistics: last, change, high/low and range, VWAP with distance
  and σ, POC and value area, volume and notional, delta and buy share,
  trades per second, average and largest print, spread, OBI, realized
  volatility, and current volume z-score

### Order book

- Price ladder with per-level size bars and cumulative depth shading
- Consolidated (multi-venue) or primary-venue source
- Raw or grouped price levels
- Liquidity-wall highlighting, spread in price and basis points, microprice
- Crossed consolidated books are labelled instead of showing a negative spread
- Resting bid/ask balance meter

### Time & sales

- Newest-first tape with millisecond timestamps, tick direction and venue
- Size filters relative to the session average print (≥2×, ≥5×, ≥10×)
- Block prints highlighted by size
- Aggressor buy/sell split over recent prints

### Order book imbalance

The OBI panel displays the relative balance between bid and ask liquidity:

```text
OBI = (bid liquidity - ask liquidity) / (bid liquidity + ask liquidity)
```

The value ranges from -1 to +1. Positive values indicate greater bid
liquidity, negative values indicate greater ask liquidity, and zero indicates
balance.

### Market depth

- Cumulative bid and ask step curves on a symmetric window around the mid
- Resting size within ±10 bp and bid/ask ratios at 10 bp and 25 bp
- Crosshair price inspection

### Cumulative delta

- Session CVD at 1s/5s/15s/1m resolution with price overlay
- One-minute CVD and price change with a divergence flag

### Volume z-score

Executed volume is bucketed into fixed 1-second flow bars and resampled to the
selected bar size. Each bar is scored against the **preceding** N bars:

```text
z = (Vₜ − mean(Vₜ₋ₙ … Vₜ₋₁)) / std(Vₜ₋ₙ … Vₜ₋₁)
```

This measures unusual participation. It is not a volatility measure. Earlier
versions showed a per-trade quantity z-score under a "Volatility" label. That
has been replaced by this time-bucketed volume z-score and a separate realized
volatility study.

### Realized volatility

- Rolling close-to-close realized volatility from log returns of fixed time
  bars, annualized (`RV = √(mean r²) · √(bars per year)`; 365-day year for
  crypto, 260-day year for FX)
- Session percentile and regime (compressed, normal, elevated, extreme)
- ATR(14) on footprint candles, live range relative to ATR, and Parkinson
  high-low volatility

### Workspace controls

- Crypto and Forex asset-class switching
- Crypto spot and perpetual market selection
- Supported venue selection for crypto
- Currency-pair selection for Forex
- Timeframe selection from one minute to four hours
- Workspace presets for order-flow, liquidity, and volatility workflows
- Theme selection (persisted in the browser)
- Panel visibility menu (persisted in the browser)
- Pointer-based panel resizing from visible borders
- Responsive single-column layout on smaller screens
- First-visit bug-report dialog with issue and direct-message options

## Supported markets

### Crypto instruments

29 USDT pairs: BTC, ETH, XRP, BNB, SOL, DOGE, TRX, ADA, HYPE, LINK, SUI, AVAX,
BCH, LTC, DOT, UNI, NEAR, APT, AAVE, ETC, ENA, ATOM, ARB, OP, INJ, FIL, SEI,
TIA and WIF. Each is listed on Binance, Bybit, OKX, Bitget and Hyperliquid
(perpetual and spot where applicable) and Coinbase spot (except TRX). Deribit
covers BTC and ETH inverse perpetuals only. When a venue does not list the
selected coin it is left out of the aggregate automatically.

Coin and exchange logos are bundled in `public/coins` and `public/venues`
(from the MIT-licensed web3icons set). HYPE, ENA, INJ and WIF use a monogram
badge until official marks are added.

### Crypto perpetual markets

| Venue | Adapter status |
| --- | --- |
| Binance Futures | Supported |
| Bybit Futures | Supported |
| OKX Futures | Supported |
| Bitget Futures | Supported |
| Hyperliquid | Supported |
| Deribit | Supported |

### Crypto spot markets

| Venue | Adapter status |
| --- | --- |
| Binance Spot | Supported |
| Bybit Spot | Supported |
| OKX Spot | Supported |
| Bitget Spot | Supported |
| Coinbase Spot | Supported |

### Forex

Forex currently uses Finnhub as the internal data source. The provider is not
selectable in the user interface. Users choose only the currency pair.

Available pairs:

- EUR/USD
- GBP/USD
- USD/JPY
- AUD/USD
- USD/CAD

Forex subscriptions use Finnhub's OANDA symbol namespace internally. For
example, EUR/USD is subscribed as `OANDA:EUR_USD`.

## Forex data model

Finnhub's browser WebSocket stream provides Forex trade ticks but does not
provide a full exchange-native level-2 order book for these pairs. The
application therefore:

- Normalizes each tick into the common trade structure
- Classifies tick direction using price movement
- Builds a responsive bid and ask quote proxy for the shared book pipeline
- Derives OBI and depth visuals from that quote proxy
- Uses tick count as volume for the volume z-score ("tick volume")

Forex OBI and depth should therefore be interpreted as quote-flow indicators,
not as a complete view of all resting liquidity across the foreign-exchange
market.

Forex market hours are enforced using New York time. The application considers
the market open from Sunday at 17:00 through Friday at 17:00. When the market
is closed, the connection status reports the closed state and stale quotes are
not passed into analytics.

## Requirements

- Node.js 20 or newer
- npm
- A Finnhub API key for Forex mode
- Network access to the selected WebSocket market-data feeds

Crypto adapters may require additional exchange-specific configuration as the
project evolves. Review the adapter and venue configuration files before
deploying a new venue.

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/zadescoxp/order-flow-screener.git
cd order-flow-tracker
npm install
```

## Environment configuration

Create a local environment file:

```bash
cp .env.example .env.local
```

If `.env.example` is not present in your checkout, create `.env.local`
manually and add:

```bash
NEXT_PUBLIC_FINNHUB_API_KEY=your_finnhub_api_key
NEXT_PUBLIC_SITE_URL=https://your-domain.example
```

`NEXT_PUBLIC_SITE_URL` sets canonical links and the absolute URLs of the
Open Graph and X/Twitter share images (rendered from `app/opengraph-image.tsx`
and `app/twitter-image.tsx`). On Vercel it is detected automatically.

Never commit `.env.local`, API keys, or other credentials. The key is exposed
to the browser because the Finnhub stream is opened from the client. Use a
restricted development key and follow Finnhub's account and usage policies.

More Forex-specific details are available in
[docs/forex_setup.md](./docs/forex_setup.md).

## Development

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Create a production build:

```bash
npm run build
```

Start the production server after building:

```bash
npm run start
```

Run the test suite:

```bash
npm test
```

Run the linter:

```bash
npm run lint
```

## Using the terminal

1. Choose Crypto or Forex in the Market selector.
2. Choose an instrument from the Instrument selector.
3. Select a timeframe.
4. For Crypto, choose a spot or perpetual market and venue. Forex uses the
   internal Finnhub source automatically.
5. Pick a workspace (Order Flow, Liquidity, Volatility), then fine-tune
   panels from the Panels menu.
6. In the footprint, switch cell modes, toggle the session Profile and the
   traded-volume Heatmap, and use Live (or double-click) to follow price.
7. Hover any chart, ladder row or print for details.
8. Drag panel borders to resize the studies dock, sidebar and sidebar panels.
9. Use the theme selector to change the visual theme without changing
   analytical behavior.

The connection status strip reports the current data-source state. If a feed
disconnects, the adapter retries with an increasing reconnect delay.

## Project structure

```text
app/
  page.tsx                 Application entry point
  globals.css              Global layout and theme styles

components/
  Terminal.tsx             Main terminal shell and panel layout
  TopBar.tsx               Market, workspace and panel controls
  MarketStatsBar.tsx       Session hero card (price and key stats)
  FootprintChart.tsx       Footprint, session profile, VWAP and heatmap
  OrderBook.tsx            Order-book ladder
  OBIPanel.tsx             Order-book imbalance gauge and history
  TimeAndSales.tsx         Time & sales tape
  CVDPanel.tsx             Cumulative volume delta
  VolumeZScorePanel.tsx    Volume z-score study
  VolatilityPanel.tsx      Realized volatility, ATR and Parkinson
  DepthOfMarket.tsx        Cumulative depth chart
  StatusBar.tsx            Feed health, lag and clock
  Logo.tsx                 orderflow mark, wordmark and GitHub icon
  AssetLogo.tsx            Coin and venue logos with monogram fallback
  IndicatorsMenu.tsx       Footprint indicator settings
  ui/                      Shared primitives (cards, pills, menus) and icons

hooks/
  useCanvas.ts             DPR-aware canvas hook and theme palette

lib/config/
  instruments.ts           Crypto instrument catalog and logo map

lib/adapters/
  exchanges.ts             Crypto adapter factory
  forex.ts                 Finnhub Forex adapter
  capabilities.ts          Venue and symbol capability checks

lib/engine/
  orderFlowEngine.ts       Candle, footprint, volume profile and OBI logic
  analytics.ts             Flow bars, volume z-score, realized volatility,
                           ATR, Parkinson, session VWAP and tick sizing

lib/managers/
  marketDataManager.ts     Adapter lifecycle and analytics dispatch

lib/store/
  terminalStore.ts         Session market data and terminal settings
  uiStore.ts               Shared UI settings

docs/
  forex_setup.md            Forex connection and symbol details
```

## Design and implementation notes

The application uses a per-session market store so the terminal can process
live market data without putting exchange-specific state directly into
presentational components. The manager batches high-frequency updates before
dispatching them to the store.

Canvas-based panels use `ResizeObserver` to adapt to their containing panel.
Panel resizing is handled by pointer-driven split handles, with minimum and
maximum dimensions to keep the analytics readable.

Theme colors are defined as CSS variables and are reused by charts, panels,
heatmaps, status indicators, and controls.

## Troubleshooting

### The connection stays in an error state

Check the browser console and confirm that `.env.local` contains a valid
`NEXT_PUBLIC_FINNHUB_API_KEY` for Forex mode. Restart the development server
after changing environment variables.

### Forex prices are not updating

Confirm that the selected pair is one of the supported pairs and that Forex
market hours are open. The terminal does not process stale ticks while the
market is closed.

### OBI or depth appears limited in Forex mode

Finnhub provides trade ticks rather than a complete level-2 Forex order book.
Forex depth and OBI are therefore derived from the normalized quote proxy
described in the Forex data model section.

### A panel is not visible

Check the active workspace and the Panels menu. Panel choices are saved in the
browser, so clear the `oft-ui-preferences` local-storage key to restore the
defaults.

### The layout looks incorrect after a browser resize

Reload the page after resizing the browser window. Canvas panels use
`ResizeObserver` and will recalculate their dimensions when their containers
change.

## Contributing

Contributions are welcome. Before opening a pull request:

1. Create a focused feature branch.
2. Keep changes limited to the relevant feature or bug.
3. Run the test suite, build, and linter.
4. Explain data-source or analytics changes in the pull request description.
5. Do not include credentials, generated build output, or local environment
   files.

For bugs, include the selected market, venue or currency pair, timeframe,
browser, reproduction steps, and relevant console errors. Do not include API
keys in reports.

## License

Apache License 2.0.
