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

### Footprint chart

- Price, time, and executed-volume visualization
- Bid volume, ask volume, total volume, and delta at each price level
- Configurable imbalance highlighting
- Stacked imbalance detection
- Candle OHLC, cumulative delta, and trade count
- Canvas rendering for efficient updates
- Crosshair interaction and synchronized chart context

### Traded-volume heatmap

- Enabled by default in the terminal
- Shows the relationship between traded volume and price
- Uses a typed-array time and price grid internally
- Paints incremental updates to an offscreen canvas
- Clips intensity near the upper percentile so one large trade does not
  dominate the entire chart
- Uses the active terminal theme and a low-opacity overlay
- Combines venue data when an aggregate crypto selection is active

The heatmap represents executed volume. It is not a resting-order-book
visualization.

### Volume and trade profiles

- Horizontal volume distribution by price
- Total, buy, sell, and delta views
- Point of control (POC)
- Value area high (VAH)
- Value area low (VAL)
- Executed-trade distribution in the trades profile

### Order book

- Live bid and ask levels
- Cumulative depth bars
- Spread and spread percentage
- Single, aggregated, and compact display modes
- Bid and ask visual separation
- Hover details for individual levels

### Order book imbalance

The OBI panel displays the relative balance between bid and ask liquidity:

```text
OBI = (bid liquidity - ask liquidity) / (bid liquidity + ask liquidity)
```

The value ranges from -1 to +1. Positive values indicate greater bid
liquidity, negative values indicate greater ask liquidity, and zero indicates
balance.

### Depth of market

- Cumulative bid and ask depth curves
- Mid-price reference
- Crosshair price inspection
- Live updates from the normalized order book

### Volatility and volume analytics

- Rolling z-score visualization
- Configurable analysis windows
- Price-movement-based volatility input for Forex data
- Volume-based z-score input for crypto data

### Workspace controls

- Crypto and Forex asset-class switching
- Crypto spot and perpetual market selection
- Supported venue selection for crypto
- Currency-pair selection for Forex
- Timeframe selection from one minute to four hours
- Tool profiles for order-flow, liquidity, and volatility workflows
- Theme selection
- Panel visibility controls
- Pointer-based panel resizing from visible borders
- Responsive single-column layout on smaller screens
- First-visit bug-report dialog with issue and direct-message options

## Supported markets

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
- Derives Forex volatility from normalized price movement

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
```

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
5. Use the Flow, Liquidity, and Volatility profile controls to activate
   relevant panels.
6. Toggle the traded-volume Heatmap independently.
7. Hover chart, profile, depth, and order-book elements for details.
8. Drag a panel border when the resize handle appears to adjust its size.
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
  TopBar.tsx               Market and workspace controls
  FootprintChart.tsx       Footprint chart and traded-volume heatmap
  OrderBook.tsx            Order-book panel
  VolumeProfile.tsx        Volume profile
  TradesProfile.tsx        Executed-trade profile
  OBIPanel.tsx             Order-book imbalance chart
  DepthOfMarket.tsx        Cumulative depth chart
  VolatilityPanel.tsx      Volatility and z-score chart
  ui/                      Shared interface primitives

lib/adapters/
  exchanges.ts             Crypto adapter factory
  forex.ts                 Finnhub Forex adapter
  capabilities.ts          Venue and symbol capability checks

lib/engine/
  orderFlowEngine.ts       Candle, footprint, volume, OBI, and z-score logic

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

Check the active tool profile and panel toggles. Panels can be independently
enabled or disabled by the profile controls.

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
