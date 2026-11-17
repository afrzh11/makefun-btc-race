// BTC dip-reversion bot for make.fun "Race a BTC trading bot live for 24 hours".
//
// Strategy (original design, long only, one position, full size):
//   - Track an integer EMA of the 1-minute closes (span EMA_SPAN, seeded as the
//     mean of the first EMA_SPAN closes). All math is bigint, so two runs on
//     the same data produce byte-identical action logs.
//   - Entry: buy with all cash when the close is DIP_BPS or more below the EMA
//     (a dip that has stretched away from its medium-term mean). Optionally
//     require the close to have ticked up from the previous bar (CONFIRM) so
//     we buy a dip that has started to recover rather than a falling knife.
//   - Exit: sell the whole position when the close is back to EXIT_BPS above
//     the EMA (the reversion is complete), or when the position's value has
//     fallen STOP_BPS below its cost (hard stop, caps the damage if the dip
//     keeps dipping). After a hard stop, no new entry for COOLDOWN_BARS bars:
//     a stop means the dip was not a dip but the start of a down move, and
//     re-entering the next dip immediately would buy the same falling knife
//     again. The cooldown lets the trend re-establish before the next entry.
//   - No trades during warm-up; never more than one order per reply.
//
// Why this shape: on 1-minute bars cbBTC is mostly noise (mean |1m move| ~4 bps)
// around a slow drift, while 60-minute swings run 40-200 bps. A full-size round
// trip costs ~26-37 bps, so only moves well above that pay. Buying a stretched
// dip and selling the reversion back through the mean is the cheapest way to
// harvest those swings without chasing breakouts (which whipsaw on this data).

import { BPS, runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// --- Strategy parameters (tuned on the kit's dev window; see BUILD_LOG.md) ---
const EMA_SPAN = 90;            // bars of the medium-term mean
const DIP_BPS = 70n;            // entry: close at least this far below the EMA
const EXIT_BPS = 60n;           // exit: close at least this far above the EMA
const STOP_BPS = 150n;          // hard stop: position value this far below its cost
const COOLDOWN_BARS = 90;       // bars to wait after a hard stop before a new entry
const CONFIRM = false;          // entry only when the close ticked up vs the prior bar
const MAX_SLIPPAGE_BPS = 100;   // 1% past the close the order was decided on

/** Integer EMA plus entry/exit state for one symbol. */
class DipReversion {
  readonly span: number;
  #warm: bigint[] = [];        // closes collected until the EMA seeds
  ema: bigint | null = null;   // current EMA value (price units)
  prevClose: bigint | null = null; // the close before the latest one
  curClose: bigint | null = null;  // the latest close pushed

  constructor(span: number) {
    this.span = span;
  }

  push(close: bigint): void {
    this.prevClose = this.curClose;
    this.curClose = close;
    if (this.ema !== null) {
      // EMA update in exact integers: ema += 2*(close-ema)/(span+1).
      this.ema += (2n * (close - this.ema)) / BigInt(this.span + 1);
    } else {
      this.#warm.push(close);
      if (this.#warm.length === this.span) {
        this.ema = this.#warm.reduce((a, x) => a + x, 0n) / BigInt(this.span);
      }
    }
  }
}

const series = new DipReversion(EMA_SPAN);
let barCount = 0;              // CBBTC bars processed (only batches that carry one)
let stopBar: number | null = null; // bar on which the last hard-stop sell was issued

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    let fresh = false;
    for (const bar of batch.bars) {
      if (bar.symbol === SYMBOL) {
        series.push(BigInt(bar.c));
        fresh = true;
      }
    }
    if (state.warmingUp || !fresh || series.ema === null) return [];
    barCount += 1;
    const close = state.close(SYMBOL);
    if (close === null) return [];
    const ema = series.ema;
    const held = state.positions.get(SYMBOL);

    if (held === undefined) {
      // Cooling down after a hard stop: do not re-enter the same down move.
      if (stopBar !== null && barCount - stopBar < COOLDOWN_BARS) return [];
      // Entry: stretched dip below the mean (optionally already recovering).
      if (close * BPS <= ema * (BPS - DIP_BPS)) {
        if (CONFIRM && series.prevClose !== null && close <= series.prevClose) return [];
        let notional = state.cash;
        const room = state.weightRoom(SYMBOL);
        if (room < notional) notional = room;
        if (notional <= 0n || notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
        return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Exit: reversion complete, or hard stop on value vs cost.
    const value = state.value(SYMBOL, held.qty);
    if (close * BPS >= ema * (BPS + EXIT_BPS)) {
      return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    if (value * BPS <= held.cost * (BPS - STOP_BPS)) {
      stopBar = barCount;
      return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});
