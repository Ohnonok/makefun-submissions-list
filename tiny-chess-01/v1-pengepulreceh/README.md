# tiny-chess-01

Strongest chess engine in 4 KB of Python (4,091 bytes).

0x88 board, alpha-beta + quiescence + transposition table + killer moves +
MVV-LVA ordering, incremental material/PST eval with king-phase
interpolation. Fixed 80,000-node budget per move (no wall clock, fully
deterministic). The source is an lzma-compressed payload with a tiny
unpacker (explicitly allowed by the rules; same approach as the Sunfish
baseline).

Run: `python3 -P -s main.py` with MAKEFUN_ENV_URL set.
