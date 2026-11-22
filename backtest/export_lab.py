#!/usr/bin/env python3
"""Shrink data_hist/ to the stock-days that can be 'in play' (rel. volume >= 1 and basic filters)
plus all QQQ days, and write lab_data.json.gz (used by lab.py --compact)."""
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import daytrader_backtest as base  # noqa: E402
import lab  # noqa: E402

raw, ctx = lab.load()
out = {"bars": {}, "ctx": {}}
for (sym, d), C in ctx.items():
    b = raw[sym][d]
    keep = sym == base.MARKET or (b[0]["o"] >= 5 and C["avgvol"] >= 1e6 and C["atr"] >= 0.5
                                   and C["avgv5"] > 0 and b[0]["v"] / C["avgv5"] >= 1.0)
    if not keep:
        continue
    k = "%s|%s" % (sym, d.isoformat())
    out["bars"][k] = [[round(x["o"], 4), round(x["h"], 4), round(x["l"], 4), round(x["c"], 4), int(x["v"])] for x in b]
    out["ctx"][k] = dict(C, prev={kk: round(v, 4) for kk, v in C["prev"].items()})
with gzip.open(os.path.join(base.HERE, "lab_data.json.gz"), "wt") as f:
    json.dump(out, f, separators=(",", ":"))
print("stock-days kept:", len(out["bars"]))
