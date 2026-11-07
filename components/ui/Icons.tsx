// Panel and control icons (lucide). One place to swap glyphs.

import {
  Activity,
  AudioWaveform,
  ChartArea,
  ChartCandlestick,
  ChartSpline,
  ChevronDown,
  ListOrdered,
  PanelsTopLeft,
  ReceiptText,
  Scale,
  Search,
  SlidersHorizontal,
  type LucideProps,
} from "lucide-react";

const base: LucideProps = { size: 16, strokeWidth: 1.75, "aria-hidden": true };

export const Icon = {
  Footprint: () => <ChartCandlestick {...base} />,
  Book: () => <ListOrdered {...base} />,
  Gauge: () => <Scale {...base} />,
  Tape: () => <ReceiptText {...base} />,
  Delta: () => <ChartSpline {...base} />,
  Bars: () => <AudioWaveform {...base} />,
  Pulse: () => <Activity {...base} />,
  Depth: () => <ChartArea {...base} />,
  Layout: () => <PanelsTopLeft {...base} />,
  Sliders: () => <SlidersHorizontal {...base} />,
  Search: () => <Search {...base} size={14} />,
  Chevron: () => <ChevronDown {...base} size={14} />,
};
