# makefun-btc-race

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/afrzh11/makefun-btc-race/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/afrzh11/makefun-btc-race/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

A BTC dip-reversion trading bot for make.fun's [Race a BTC trading bot live for 24 hours](https://make.fun/bounty/btc-race-24h-20261117-0603) bounty ($250 in USDC, 10 places paid). It races a $1,000 paper portfolio on cbBTC for 24 hours of one-minute bars, long only, one position at a time.

## Strategy

On 1-minute bars cbBTC is mostly noise (mean |1m move| ~4 bps) around a slow drift, while hourly swings run 40–200 bps — and a full-size round trip costs ~26–37 bps in fees, slippage and price impact. So the bot only trades moves big enough to pay for themselves:

- **Mean:** an integer EMA of the 1-minute closes (span 90, seeded as the mean of the first 90 closes). All math is bigint, so two runs on the same data produce byte-identical action logs.
- **Entry:** buy with all cash when the close is 70 bps or more below the EMA — a dip stretched away from its medium-term mean.
- **Exit:** sell the whole position when the close is back to 60 bps above the EMA (reversion complete), or when the position's value has fallen 150 bps below its cost (hard stop).
- **Risk controls:** long only, max one open position, one order per reply, max 1% slippage, no trades during warm-up. No hard-coded timestamps or prices; only bars already closed are used.

## Dev-window result

Graded with the kit's local harness (`grade-local --driver process`) on the frozen 24h dev window (1,440 one-minute bars):

| Metric | Value |
| --- | --- |
| Net PnL | **+$26.41** (2.64% on $1,000) |
| Trades | 6 (3 round trips, 100% win rate) |
| Max drawdown | 0.72% |
| Fees | $2.44 (still +$23.96 at 2× fees) |
| Rejected orders | 0 |
| Determinism | Two runs produce byte-identical action logs (`action_log_sha256 5d27bf89…`) |

The dev gate is net PnL > $0 — this clears it with a ~$26 margin. For comparison, the kit's baselines on the same window: buy-and-hold +$1.07, momentum +$2.45, ema-cross −$106.21, rsi-bollinger −$24.25, adx-momentum −$32.66, hold-cash $0 (fails the gate).

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/bars-replay/v1` on stdin/stdout (newline-delimited JSON). `vendor/makefun-bars.ts` is the kit's SDK shim, copied unchanged. Requires Node 22; no dependencies, no network, no wall clock.

---

<sub>Entered on [make.fun](https://make.fun/?ref=00whd2w5&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>
