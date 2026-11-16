# pumpfun-top5-forecast-01 entry

Simple forecaster for the top 5 new pump.fun coins by market cap, 24 hours out.

**Design (volume + holder count only, per the brief).** The snapshot rows
carry no volume and no holder-count field, so the entry uses the closest
simple proxies and invents nothing:

- **Volume proxy = SOL inflow**: the change in a coin's
  `quote_reserves_lamports` between the last mark and the mark before it.
  Buys push SOL into the curve/pool, so rising reserves mean real buying.
- **Momentum** = log10 market-cap growth over the same step.
- **Holder proxy**: none exists in the data, so none is faked. The only
  quality gate is graduation (`complete=true` and `venue=pool`).

**Score.** `growth = momentum * (1 + normalised SOL inflow)`, each
clamped; a coin's projected size is its log10 cap in SOL grown by that
growth, capped at ±0.5 dex. Coins rank by projected size — a large coin
with modest growth outranks a tiny coin with huge growth. Graduated coins
rank first; if fewer than 5 exist, the largest non-graduated ones fill in.

**Forecast.** Mirrors the house baseline's shape on the ranked order:
place k gets 0.30 on ranked coin #k and 0.10 on #k−1 and #k+1, the rest
left unnamed for movers and coins born after the cut. Sizes are a normal
in log10(cap in SOL) around the ranked coin's projected cap, sd 0.40,
binned on `task.json`'s edges. Deterministic (no clock, no random; ties
break on the mint address).

**Local test.** From the kit directory:

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

On the practice input it exits 0, writes a valid `forecast.json`
(13,081 bytes), and is byte-identical across runs. On the practice's one
known answer read (its last read) its order score is −19.219 against the
house baseline's −23.314 — a +4.095-nat improvement, from naming MIHAO VI
at place 2 (0.30) and Google at place 3 (0.10). See
`transcript-pumpfun-top5-forecast.md` in the submission folder for the
full write-up.
