# Order Flow Tracker

**Production-ready, open-source, real-time crypto market-data screening terminal.**

> ⚡ Live footprint charts · Order book · OBI · Volume Profile · Depth of Market · Volatility Z-Score

---

## What This Is

A professional **market-data and order-flow screener** for crypto perpetuals and spot markets.

**This is NOT a trading application.** There is:
- ❌ No trading
- ❌ No order execution  
- ❌ No buy/sell buttons
- ❌ No broker integration
- ❌ No portfolio management

Users **observe**, **analyze**, **compare** and **screen** live market data.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| State | Zustand (with subscribeWithSelector) |
| Charts | Canvas / 2D rendering |
| Data | Live WebSocket exchange feeds |
| Testing | Jest + ts-jest |

---

## Architecture

```
Exchange WebSockets
        ↓
Exchange Adapters (lib/adapters/)
        ↓
Normalized Market Data (lib/types/market.ts)
        ↓
Order Flow Engine (lib/engine/orderFlowEngine.ts)
        ↓
Market Data Manager (lib/managers/marketDataManager.ts)
        ↓
Zustand Store (lib/store/terminalStore.ts)
        ↓
React Components (components/)
```

---

## Supported Exchanges

### Perpetuals
| Exchange | Status |
|----------|--------|
| Binance Futures | ✅ Live |
| Bybit Futures | ✅ Live |
| OKX Futures | ✅ Live |
| Hyperliquid | ✅ Live |

### Spot
| Exchange | Status |
|----------|--------|
| Binance Spot | ✅ Live |

---

## Features

### Footprint Chart
- Price × Time × Executed Volume visualization
- Bid/Ask volume at every price level
- Per-level delta (askVol - bidVol)
- Imbalance highlighting (3x threshold, configurable)
- Z-score volume emphasis (subtle border highlighting)
- Stacked imbalance detection
- Canvas-rendered for performance (no DOM elements per cell)

### Order Book
- Live bid/ask levels with cumulative depth bars
- Single venue / Aggregated / Compact modes
- Spread display

### OBI (Order Book Imbalance)
- Current OBI value: -1 (ask-heavy) → 0 (balanced) → +1 (bid-heavy)
- Historical OBI chart with fill gradient

### Volume Profile
- Horizontal volume profile by price
- Total / Buy / Sell / Delta tabs
- POC, VAH, VAL identification
- Synchronized with footprint crosshair

### Trades Profile
- Executed trade distribution by price
- Volume / Trade count toggle

### Depth of Market
- Cumulative bid/ask depth curve
- Crosshair synchronized

### Volatility / Z-Score
- Rolling Z-score of trade volume
- Color-coded: ±1 (yellow), ±2 (orange), ±3 (red)
- Volume Heatmap mode
- Configurable rolling windows: 20, 50, 100, 200

### Order Flow Analytics
- Delta divergence detection (Price↑ + Delta↓ = observation)
- Potential absorption detection
- Stacked imbalance detection (configurable minimum levels)
- Cumulative delta tracking

---

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run tests
npm test
```

Open [http://localhost:3000](http://localhost:3000).

---

## Project Structure

```
order-flow-tracker/
├── app/
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Entry point → Terminal
│   └── globals.css         # Terminal theme CSS
├── components/
│   ├── Terminal.tsx        # Main layout grid
│   ├── TopBar.tsx          # Asset/timeframe/venue/profile selector
│   ├── FootprintChart.tsx  # Canvas footprint renderer
│   ├── VolumeProfile.tsx   # Canvas volume profile
│   ├── OrderBook.tsx       # Live order book panel
│   ├── OBIPanel.tsx        # OBI value + history chart
│   ├── DepthOfMarket.tsx   # Cumulative depth chart
│   ├── VolatilityPanel.tsx # Z-score + heatmap
│   ├── TradesProfile.tsx   # Trades distribution profile
│   └── ConnectionStatus.tsx # Per-venue status dots
├── lib/
│   ├── types/
│   │   └── market.ts       # All normalized types
│   ├── adapters/
│   │   ├── base.ts         # Abstract exchange adapter
│   │   ├── binanceFutures.ts
│   │   └── exchanges.ts    # Bybit, OKX, Hyperliquid, Binance Spot
│   ├── engine/
│   │   └── orderFlowEngine.ts  # Core footprint engine
│   ├── managers/
│   │   └── marketDataManager.ts  # Adapter lifecycle manager
│   └── store/
│       └── terminalStore.ts  # Zustand store
├── hooks/
│   └── useMarketData.ts    # Market data subscription hook
└── __tests__/
    └── orderFlowEngine.test.ts  # 33 unit tests
```

---

## Data Normalization

Every exchange adapter transforms native messages into:

```typescript
interface NormalizedTrade {
  id: string
  venue: Venue
  symbol: string
  timestamp: number      // exchange timestamp
  localTimestamp: number // receive timestamp
  price: number
  quantity: number
  quoteVolume: number
  side: "buy" | "sell"  // aggressor side
  marketType: "spot" | "perpetual"
  sequence?: number
}
```

---

## Trade Classification

Exchange-provided aggressor side is used when available. Tick-rule fallback:

```
price > prevPrice → buy
price < prevPrice → sell
price = prevPrice → previous direction
```

---

## Unit Tests

```bash
npm test
```

**33 tests covering:**
- Trade classification (tick-rule)
- Price tick rounding
- Candle open time bucketing
- Delta computation (buy/sell/mixed)
- OBI formula (edge cases)
- Imbalance detection (3x threshold, custom threshold)
- Stacked imbalance detection
- Z-score calculation
- Volume profile (POC, VAH, VAL, delta)
- Cross-candle price-level aggregation

---

## Critical Rules

1. This is a **screening and analytics** application only — no trade execution
2. All data comes from **live exchange WebSockets** — no mock data
3. Exchange-specific parsing is **isolated inside adapters** — never in React components
4. The footprint chart represents **actual executed trades** aggregated by price and time
5. Stale/disconnected data is **never silently displayed**

---

## License

MIT
