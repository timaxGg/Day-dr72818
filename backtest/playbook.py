#!/usr/bin/env python3
"""
Playbook test: strategies taken from research papers and trader education, coded with
their published rules and NOT tuned on our data (so the result is an honest test).

  1  ORB stocks in play  Zarattini, Barbon & Aziz (2024), "A Profitable Day Trading Strategy
                         For The U.S. Equity Market": top 20 stocks by first-5-minute relative
                         volume (>=100%), price>$5, 14-day avg volume>=1M, ATR>$0.50; trade in the
                         direction of the first 5-min candle on a break of its high/low; stop
                         10% of daily ATR; exit at the close.
  2  ORB top 5           same, only the 5 most "in play" stocks.
  3  Noise area (QQQ)    Zarattini, Aziz & Barbon, "Beat the Market" intraday momentum: trade
                         QQQ when it leaves the 14-day "noise area" around the open, checked at
                         HH:00 / HH:30; trailing stop at the boundary / VWAP; flat at the close.
  4  Gap and go          gap >= 3% on a stock in play, buy the break of the first 5-min high
                         (short the break of the low on gap-downs); stop the other side; exit 2R
                         or close.
  5  VWAP bounce         stock in play above VWAP for 30+ min, pulls back to VWAP, closes back
                         above with a green candle -> long; stop below the pullback low; 2R/close.
  6  9/20 EMA pullback   5-min 9 EMA > 20 EMA, 9 EMA above VWAP; price dips to the 9/20 EMA and
                         closes green -> long; stop below the 20 EMA; 2R/close.
  7  Bull flag           pole of 2+ strong green candles with rising volume, 2-5 candle flag
                         drifting lower on lighter volume (<=50% retrace); buy the flag-high
                         break; stop flag low; target = pole height.
  8  Connors RSI(2)      daily: close above its 100-day average (200 needs more history than
                         we have) and RSI(2) < 10 -> buy at the close; sell when the close is
                         above the 5-day average. Multi-day.
  9  Last-half-hour      at 15:30 buy the day's 5 biggest losers among stocks in play (research:
     loser rebound       intraday losers tend to rebound in the last half hour); sell at 15:55.

Each trade: EUR 100 at leverage x5 and x10, fee per order USD 1.00 and 0.35, 0.02% slippage.
Usage: python playbook.py (uses data/ downloaded by search10k.py data). Writes playbook_results.txt
"""
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import daytrader_backtest as base  # noqa: E402
import search10k as eng  # noqa: E402

EUR = base.EURUSD
SLIP = 0.0002
SLOTS = base.SLOTS
IDX = base.SLOT_INDEX


# ------------------------------------------------------------------ data
def load():
    raw = {}
    for sym in eng.UNIVERSE + [base.MARKET]:
        p = os.path.join(base.DATA, sym + ".json")
        if os.path.exists(p):
            dd = base.to_days(json.load(open(p)))
            if dd:
                raw[sym] = dd
    days = sorted(set(d for v in raw.values() for d in v))
    info = {}                                    # (sym, d) -> per-day context from the past only
    for sym, dd in raw.items():
        ds = sorted(dd)
        daily = []
        for d in ds:
            b = dd[d]
            daily.append(dict(o=b[0]["o"], h=max(x["h"] for x in b), l=min(x["l"] for x in b), c=b[-1]["c"],
                              v=sum(x["v"] for x in b), v5=b[0]["v"]))
        for k, d in enumerate(ds):
            if k < 15:
                continue
            past = daily[k - 14:k]
            trs = [max(x["h"] - x["l"], abs(x["h"] - y["c"]), abs(x["l"] - y["c"])) for y, x in zip(daily[k - 15:k - 1], past)]
            closes = [x["c"] for x in daily[:k]]
            info[(sym, d)] = dict(atr=sum(trs) / 14, avgvol=sum(x["v"] for x in past) / 14,
                                  avgv5=sum(x["v5"] for x in past) / 14, prev=daily[k - 1],
                                  closes=closes, today=daily[k], k=k, ds=ds)
    return raw, days, info


def vwap(b):
    out, pv, vv = [], 0.0, 0.0
    for x in b:
        pv += (x["h"] + x["l"] + x["c"]) / 3 * x["v"]; vv += x["v"]
        out.append(pv / vv if vv else x["c"])
    return out


def ema(vals, n):
    a = 2 / (n + 1); out = []; e = vals[0]
    for v in vals:
        e = a * v + (1 - a) * e; out.append(e)
    return out


def in_play(raw, info, d, top):
    """Stocks in play today (decided at 9:35 from the first 5-min bar)."""
    sc = []
    for sym in raw:
        if sym == base.MARKET or (sym, d) not in info or d not in raw[sym]:
            continue
        I = info[(sym, d)]; b0 = raw[sym][d][0]
        if b0["o"] < 5 or I["avgvol"] < 1e6 or I["atr"] < 0.5 or I["avgv5"] <= 0:
            continue
        rv = b0["v"] / I["avgv5"]
        if rv >= 1.0:
            sc.append((rv, sym))
    sc.sort(reverse=True)
    return [s for _, s in sc[:top]]


# ------------------------------------------------------------------ trade helper
def run_intraday(b, j_entry, side, stop, target=None, trail_fn=None, entry_px=None, exit_j=77):
    """Enter at bar j_entry (at entry_px or its open). Returns the % return (after slippage) or None."""
    if j_entry >= 78:
        return None
    px = entry_px if entry_px is not None else b[j_entry]["o"]
    px *= (1 + SLIP * side)
    if (px - stop) * side <= 0:
        return None
    for j in range(j_entry, exit_j + 1):
        x = b[j]
        if j == j_entry and entry_px is not None:
            # we only know the 5-min bar, not whether its low came before or after our fill:
            # judge the entry bar by its close only
            x = dict(o=x["c"], h=x["c"], l=x["c"], c=x["c"])
        if True:
            if (side > 0 and x["l"] <= stop) or (side < 0 and x["h"] >= stop):
                ex = min(x["o"], stop) if side > 0 else max(x["o"], stop)
                if j == j_entry:
                    ex = stop
                return (ex * (1 - SLIP * side) - px) / px * side
            if target is not None and ((side > 0 and x["h"] >= target) or (side < 0 and x["l"] <= target)):
                return (target * (1 - SLIP * side) - px) / px * side
        if trail_fn:
            ns = trail_fn(j)
            if ns is not None:
                stop = max(stop, ns) if side > 0 else min(stop, ns)
    return (b[exit_j]["c"] * (1 - SLIP * side) - px) / px * side


# ------------------------------------------------------------------ strategies (each yields (date, sym, return))
def s_orb(raw, days, info, top):
    for d in days:
        for sym in in_play(raw, info, d, top):
            b = raw[sym][d]; c0 = b[0]
            side = 1 if c0["c"] > c0["o"] else (-1 if c0["c"] < c0["o"] else 0)
            if not side:
                continue
            lvl = c0["h"] if side > 0 else c0["l"]
            for j in range(1, 78):                      # stop order: fills when price trades through the level
                if (side > 0 and b[j]["h"] >= lvl) or (side < 0 and b[j]["l"] <= lvl):
                    fill = max(lvl, b[j]["o"]) if side > 0 else min(lvl, b[j]["o"])
                    stop = fill - side * 0.10 * info[(sym, d)]["atr"]
                    r = run_intraday(b, j, side, stop, entry_px=fill)
                    if r is not None:
                        yield d, sym, r
                    break


def s_noise(raw, days, info):
    sym = base.MARKET
    if sym not in raw:
        return
    ds = sorted(raw[sym])
    for k, d in enumerate(ds):
        if k < 15:
            continue
        b = raw[sym][d]; o = b[0]["o"]; pc = raw[sym][ds[k - 1]][-1]["c"]
        sig = [sum(abs(raw[sym][p][j]["c"] / raw[sym][p][0]["o"] - 1) for p in ds[k - 14:k]) / 14 for j in range(78)]
        vw = vwap(b)
        up = [max(o, pc) * (1 + s) for s in sig]; dn = [min(o, pc) * (1 - s) for s in sig]
        for j in range(5, 77):
            if SLOTS[j + 1] % 100 not in (0, 30) if j + 1 < 78 else True:
                continue                                 # decide on the bar that closes at HH:00 / HH:30
            c = b[j]["c"]
            side = 1 if c > up[j] else (-1 if c < dn[j] else 0)
            if not side:
                continue
            stop = max(up[j], vw[j]) if side > 0 else min(dn[j], vw[j])
            if (c - stop) * side <= 0:
                stop = c - side * 0.003 * c
            trail = (lambda jj, s=side: (max(up[jj], vw[jj]) if s > 0 else min(dn[jj], vw[jj])))
            r = run_intraday(b, j + 1, side, stop, trail_fn=trail)
            if r is not None:
                yield d, sym, r
            break


def s_gapgo(raw, days, info):
    for d in days:
        for sym in in_play(raw, info, d, 20):
            I = info[(sym, d)]; b = raw[sym][d]
            g = b[0]["o"] / I["prev"]["c"] - 1
            if abs(g) < 0.03:
                continue
            side = 1 if g > 0 else -1
            lvl = b[0]["h"] if side > 0 else b[0]["l"]; stop = b[0]["l"] if side > 0 else b[0]["h"]
            for j in range(1, IDX[1100]):
                if (side > 0 and b[j]["h"] > lvl) or (side < 0 and b[j]["l"] < lvl):
                    fill = max(lvl, b[j]["o"]) if side > 0 else min(lvl, b[j]["o"])
                    risk = abs(fill - stop)
                    r = run_intraday(b, j, side, stop, target=fill + side * 2 * risk, entry_px=fill)
                    if r is not None:
                        yield d, sym, r
                    break


def s_vwap_bounce(raw, days, info):
    for d in days:
        for sym in in_play(raw, info, d, 20):
            b = raw[sym][d]; vw = vwap(b)
            above = 0
            for j in range(1, IDX[1500]):
                if b[j]["l"] > vw[j]:
                    above += 1; continue
                if above >= 6 and b[j]["l"] <= vw[j] * 1.001 and b[j]["c"] > vw[j] and b[j]["c"] > b[j]["o"]:
                    stop = b[j]["l"] - 0.01; fill = b[j + 1]["o"]; risk = fill - stop
                    if risk > 0:
                        r = run_intraday(b, j + 1, 1, stop, target=fill + 2 * risk)
                        if r is not None:
                            yield d, sym, r
                    break
                above = 0


def s_ema(raw, days, info):
    for d in days:
        for sym in in_play(raw, info, d, 20):
            b = raw[sym][d]; cl = [x["c"] for x in b]; e9 = ema(cl, 9); e20 = ema(cl, 20); vw = vwap(b)
            for j in range(IDX[1000], IDX[1500]):
                if e9[j] > e20[j] and e9[j] > vw[j] and b[j]["l"] <= e9[j] and b[j]["c"] > e9[j] and b[j]["c"] > b[j]["o"] \
                        and b[j]["l"] >= e20[j] * 0.997:
                    stop = min(e20[j], b[j]["l"]) - 0.01; fill = b[j + 1]["o"]; risk = fill - stop
                    if risk > 0:
                        r = run_intraday(b, j + 1, 1, stop, target=fill + 2 * risk)
                        if r is not None:
                            yield d, sym, r
                    break


def s_flag(raw, days, info):
    for d in days:
        for sym in in_play(raw, info, d, 20):
            b = raw[sym][d]; a = info[(sym, d)]["atr"] / 8          # rough 5-min candle size
            done = False
            for p in range(2, IDX[1430]):
                p1, p2 = b[p - 1], b[p]
                pole = p1["c"] > p1["o"] and p2["c"] > p2["o"] and p2["v"] >= p1["v"] and \
                    (p2["c"] - p1["o"]) >= 2 * a and (p2["c"] - p2["o"]) >= 0.6 * (p2["h"] - p2["l"])
                if not pole:
                    continue
                top, base_ = p2["h"], p1["o"]
                for n in range(2, 6):
                    f = b[p + 1:p + 1 + n]
                    if len(f) < n or p + 1 + n >= 77:
                        break
                    lo = min(x["l"] for x in f); hi = max(x["h"] for x in f)
                    if hi > top or lo < top - 0.5 * (top - base_) or sum(x["v"] for x in f) / n > p2["v"]:
                        break
                    nxt = b[p + 1 + n]
                    if nxt["h"] > hi:
                        fill = max(hi, nxt["o"]); target = fill + (top - base_)
                        r = run_intraday(b, p + 1 + n, 1, lo - 0.01, target=target, entry_px=fill)
                        if r is not None:
                            yield d, sym, r
                        done = True
                        break
                if done:
                    break


def s_rsi2(raw, days, info):
    for sym in raw:
        if sym == base.MARKET:
            continue
        ds = sorted(raw[sym]); closes = [raw[sym][d][-1]["c"] for d in ds]
        k = 101
        while k < len(ds) - 1:
            c = closes[k]; sma100 = sum(closes[k - 100:k]) / 100
            g = [max(closes[i] - closes[i - 1], 0) for i in range(k - 1, k + 1)]
            l_ = [max(closes[i - 1] - closes[i], 0) for i in range(k - 1, k + 1)]
            rsi = 100 if sum(l_) == 0 else 100 - 100 / (1 + sum(g) / sum(l_))
            if c > sma100 and rsi < 10:
                e = c * (1 + SLIP)
                for h in range(k + 1, min(k + 11, len(ds))):
                    if closes[h] > sum(closes[h - 4:h + 1]) / 5 or h == min(k + 10, len(ds) - 1):
                        yield ds[k], sym, (closes[h] * (1 - SLIP) - e) / e
                        k = h
                        break
            k += 1


def s_lasthalf(raw, days, info):
    j = IDX[1530] - 1
    for d in days:
        sc = []
        for sym in in_play(raw, info, d, 40):
            b = raw[sym][d]; sc.append((b[j]["c"] / b[0]["o"] - 1, sym))
        sc.sort()
        for r0, sym in sc[:5]:
            if r0 < 0:
                r = run_intraday(raw[sym][d], j + 1, 1, raw[sym][d][j + 1]["o"] * 0.97)
                if r is not None:
                    yield d, sym, r


STRATS = [
    ("1 ORB stocks in play (top 20)", lambda R, D, I: s_orb(R, D, I, 20)),
    ("2 ORB stocks in play (top 5)", lambda R, D, I: s_orb(R, D, I, 5)),
    ("3 Noise-area momentum on QQQ", s_noise),
    ("4 Gap and go", s_gapgo),
    ("5 VWAP bounce", s_vwap_bounce),
    ("6 9/20 EMA pullback", s_ema),
    ("7 Bull flag", s_flag),
    ("8 Connors RSI(2), multi-day", s_rsi2),
    ("9 Last-half-hour loser rebound", s_lasthalf),
]


def main():
    raw, days, info = load()
    lines = []

    def say(s=""):
        print(s, flush=True); lines.append(s)

    tdays = [d for d in days if any((s, d) in info for s in raw)]
    say("Playbook test: %d stocks, %s..%s (%d trading days). Fixed published rules, no tuning." % (
        len(raw) - 1, tdays[0], tdays[-1], len(tdays)))
    say("EUR 100 per trade. Results per day = total / %d trading days." % len(tdays))
    say("")
    say("%-34s %6s %6s %8s | %-27s | %-27s" % ("strategy", "trades", "win%", "avg move", "x5: EUR/day fee$1 / $0.35", "x10: EUR/day fee$1 / $0.35"))
    for name, fn in STRATS:
        tr = list(fn(raw, days, info))
        if not tr:
            say("%-34s  no trades" % name); continue
        n = len(tr); win = 100 * sum(1 for _, _, r in tr if r > 0) / n; avg = sum(r for _, _, r in tr) / n
        cells = []
        for lev in (5, 10):
            for fee in (1.0, 0.35):
                tot = sum(r * 100 * lev - 2 * fee / EUR for _, _, r in tr)
                cells.append(tot / len(tdays))
        say("%-34s %6d %5.0f%% %7.3f%% | %+8.2f / %+8.2f           | %+8.2f / %+8.2f" % (
            name, n, win, 100 * avg, cells[0], cells[1], cells[2], cells[3]))
        bym = defaultdict(float)
        for d, _, r in tr:
            bym["%d-%02d" % (d.year, d.month)] += r * 1000 - 2 * 0.35 / EUR
        say("     by month (x10, fee $0.35): " + "  ".join("%s %+.0f" % (m[2:], v) for m, v in sorted(bym.items())))
    say("")
    say("avg move = average price move per trade after slippage, before fees.")
    with open(os.path.join(base.HERE, "playbook_results.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
