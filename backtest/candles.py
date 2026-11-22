#!/usr/bin/env python3
"""
Candlestick-pattern search for the Day-Trader bot (10,000 methods, walk-forward judged).

Patterns, read on 5-, 15- or 30-minute candles built from the 5-minute data:
  hammer / shooting star (pin bar), bullish / bearish engulfing, morning / evening star,
  three white soldiers / three black crows, inside-bar breakout, doji + confirmation,
  marubozu (strong full-body candle), tweezer bottom / top, piercing line / dark cloud cover.

Where the candle appears matters, so each method also picks a location:
  anywhere, at the day's low/high so far, at VWAP, at the opening-range low/high,
  at yesterday's low/high.
Plus: yesterday's daily candle (bullish / bearish / any), trend (VWAP, 20-day),
volume of the pattern candle, and the exit rule (stop beyond the pattern, target, trail,
hold until close or 1-2 days).

Usage: same commands as search10k.py (data / run K N / merge / selftest).
Results: candle_results.txt
"""
import os
import random
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import search10k as eng  # noqa: E402

eng.RESULTS = "candle_results.txt"
IDX = eng.IDX

PATTERNS = ["pin", "engulf", "star", "three", "inside", "doji", "marubozu", "tweezer", "pierce"]


def agg(P, tf):
    """5-minute bars -> tf-minute candles (each with the 5-min index where it closes)."""
    key = "_agg%d" % tf
    if key in P:
        return P[key]
    k = tf // 5; b = P["bars"]; out = []
    for s in range(0, 78 - k + 1, k):
        g = b[s:s + k]
        out.append(dict(o=g[0]["o"], h=max(x["h"] for x in g), l=min(x["l"] for x in g), c=g[-1]["c"],
                        v=sum(x["v"] for x in g), j=s + k - 1,
                        vs=sum(P["slot"][s:s + k])))
    P[key] = out
    return out


def body(c):
    return abs(c["c"] - c["o"])


def rng(c):
    return max(c["h"] - c["l"], 1e-9)


def pattern(name, C, t, atr):
    """+1 bullish, -1 bearish, 0 none, for the candle C[t] (with the ones before it)."""
    c = C[t]; p = C[t - 1] if t >= 1 else None; pp = C[t - 2] if t >= 2 else None
    up, dn = c["c"] > c["o"], c["c"] < c["o"]
    if name == "pin":
        lw = min(c["o"], c["c"]) - c["l"]; uw = c["h"] - max(c["o"], c["c"]); bd = max(body(c), rng(c) * 0.05)
        if lw >= 2 * bd and uw <= bd and rng(c) >= 0.5 * atr:
            return 1
        if uw >= 2 * bd and lw <= bd and rng(c) >= 0.5 * atr:
            return -1
    elif name == "engulf" and p:
        if up and p["c"] < p["o"] and c["c"] >= p["o"] and c["o"] <= p["c"] and body(c) > body(p):
            return 1
        if dn and p["c"] > p["o"] and c["c"] <= p["o"] and c["o"] >= p["c"] and body(c) > body(p):
            return -1
    elif name == "star" and pp:
        small = body(p) <= 0.3 * rng(p)
        if pp["c"] < pp["o"] and body(pp) >= 0.5 * rng(pp) and small and up and c["c"] > (pp["o"] + pp["c"]) / 2:
            return 1
        if pp["c"] > pp["o"] and body(pp) >= 0.5 * rng(pp) and small and dn and c["c"] < (pp["o"] + pp["c"]) / 2:
            return -1
    elif name == "three" and pp:
        if all(x["c"] > x["o"] and body(x) >= 0.5 * rng(x) for x in (pp, p, c)) and pp["c"] < p["c"] < c["c"]:
            return 1
        if all(x["c"] < x["o"] and body(x) >= 0.5 * rng(x) for x in (pp, p, c)) and pp["c"] > p["c"] > c["c"]:
            return -1
    elif name == "inside" and pp:
        mother, ins = pp, p                      # pp = mother bar, p inside it, c breaks out
        if ins["h"] <= mother["h"] and ins["l"] >= mother["l"]:
            if c["c"] > mother["h"]:
                return 1
            if c["c"] < mother["l"]:
                return -1
    elif name == "doji" and p:
        if body(p) <= 0.1 * rng(p) and rng(p) >= 0.3 * atr:
            if up and c["c"] > p["h"]:
                return 1
            if dn and c["c"] < p["l"]:
                return -1
    elif name == "marubozu":
        if body(c) >= 0.85 * rng(c) and rng(c) >= 1.2 * atr:
            return 1 if up else (-1 if dn else 0)
    elif name == "tweezer" and p:
        tol = 0.1 * atr
        if p["c"] < p["o"] and up and abs(c["l"] - p["l"]) <= tol:
            return 1
        if p["c"] > p["o"] and dn and abs(c["h"] - p["h"]) <= tol:
            return -1
    elif name == "pierce" and p:
        mid = (p["o"] + p["c"]) / 2
        if p["c"] < p["o"] and up and c["o"] <= p["c"] and c["c"] > mid and c["c"] < p["o"]:
            return 1
        if p["c"] > p["o"] and dn and c["o"] >= p["c"] and c["c"] < mid and c["c"] > p["o"]:
            return -1
    return 0


def draw_candle_methods(n, seed=11):
    rnd = random.Random(seed)
    seen, out = set(), []
    while len(out) < n:
        swing = rnd.random() < 0.2
        m = dict(fam="candle",
                 pat=rnd.choice(PATTERNS),
                 tf=rnd.choice([5, 15, 30]),
                 loc=rnd.choice(["any", "dayext", "vwap", "orb", "prevday"]),
                 daily=rnd.choice(["any", "with", "against"]),     # yesterday's daily candle
                 trend=rnd.choice([0, 1]),                          # trade with the 20-day trend
                 regime=rnd.choice([0, 1]), mkt_now=rnd.choice([0, 1]),
                 volx=rnd.choice([0, 1.0, 1.5, 2.0]),
                 short=rnd.choice([0, 1]),
                 start=rnd.choice([945, 1000, 1030, 1100]),
                 hold=rnd.choice([1, 2]) if swing else 0,
                 lev=rnd.choice([1, 2, 3]) if swing else rnd.choice([3, 5, 10]),
                 stop=rnd.choice(["pattern", "atr"]),
                 stop_atr=rnd.choice([1.0, 1.5, 2.0, 3.0]),
                 target_r=rnd.choice([0, 1, 1.5, 2, 3]),
                 trail=rnd.choice([0, 0, 1]),
                 max_open=rnd.choice([1, 3]), max_new=rnd.choice([1, 3, 6]))
        key = json.dumps(m, sort_keys=True)
        if key not in seen:
            seen.add(key); out.append(m)
    return out


def candle_signals(m, d, S, M):
    out = []
    tf = m["tf"]; mt = M["trend"] if (M and m["regime"]) else 0
    jstart = IDX[m["start"]] - 1; jend = IDX[1530] - 1
    for sym, P in S.items():
        C = agg(P, tf)
        prev = P.get("prev_day")
        for t in range(2, len(C)):
            c = C[t]; j = c["j"]
            if j < jstart or j >= jend:
                continue
            side = pattern(m["pat"], C, t, P["atr"][j] * (tf / 5) ** 0.5)
            if not side or (side < 0 and not m["short"]):
                continue
            a = P["atr"][j]; px = c["c"]; vw = P["vw"][j]
            # location of the pattern
            lo_so_far = min(x["l"] for x in P["bars"][:j + 1]); hi_so_far = max(x["h"] for x in P["bars"][:j + 1])
            pl, ph = min(x["l"] for x in C[t - 2:t + 1]), max(x["h"] for x in C[t - 2:t + 1])
            L = m["loc"]; near = 0.5 * a
            if L == "dayext" and not ((side > 0 and pl <= lo_so_far + near) or (side < 0 and ph >= hi_so_far - near)):
                continue
            if L == "vwap" and not (pl - near <= vw <= ph + near):
                continue
            if L == "orb" and not ((side > 0 and abs(pl - P["orl"]) <= near) or (side < 0 and abs(ph - P["orh"]) <= near)):
                continue
            if L == "prevday":
                if not prev:
                    continue
                if not ((side > 0 and abs(pl - prev["l"]) <= near) or (side < 0 and abs(ph - prev["h"]) <= near)):
                    continue
            # context filters
            if m["daily"] != "any" and prev:
                dside = 1 if prev["c"] > prev["o"] else -1
                if (m["daily"] == "with" and dside != side) or (m["daily"] == "against" and dside == side):
                    continue
            if m["trend"] and P["trend"] != side:
                continue
            if mt and mt != side:
                continue
            if m["mkt_now"] and M and (M["bars"][j]["c"] - M["vw"][j]) * side < 0:
                continue
            if m["volx"] and c["v"] < m["volx"] * max(c["vs"], 1):
                continue
            hint = (pl - 0.05 * a) if side > 0 else (ph + 0.05 * a)
            out.append((j, sym, side, hint if m["stop"] == "pattern" else None))
            break                                   # one signal per stock per day
    return sorted(out, key=lambda x: x[0])


def add_prev_day(S):
    days = sorted(S)
    last = {}
    for d in days:
        for sym, P in S[d].items():
            P["prev_day"] = last.get(sym)
        for sym, P in S[d].items():
            b = P["bars"]
            last[sym] = dict(o=b[0]["o"], h=max(x["h"] for x in b), l=min(x["l"] for x in b), c=b[-1]["c"])


# plug the candle pieces into the walk-forward engine
_orig_load = eng.load_all


def load_all(download):
    days, S, MP = _orig_load(download)
    add_prev_day(S)
    return days, S, MP


eng.load_all = load_all
eng.signals = candle_signals
eng.draw_methods = draw_candle_methods

if __name__ == "__main__":
    eng.main()
