/**
 * Server-component wrapper for the ticker carousel.
 *
 * Reads the build-time snapshot on the server (the parent layout.tsx stays a
 * server component) and hands the entries to the client `<TickerCarousel>`,
 * which owns hover-pause + render-time AnimatedNumber tween logic.
 *
 * Once Phase 7 wires the live `api.vizzor.ai/v1/site/ticker` SWR feed, the
 * client carousel can subscribe directly without changing this wrapper.
 */

import { getTicker } from '@/lib/snapshot';
import { TickerCarousel } from './ticker-carousel';

export function TickerCarouselServer() {
  const entries = getTicker();
  return <TickerCarousel entries={entries} />;
}
