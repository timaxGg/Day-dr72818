#!/usr/bin/env python3
"""
Day-Trader bot - five different strategy types, tested the same honest way
(tune on the older days = TRAIN, judge only on the newer unseen days = TEST).

  A  ORB30      break of the first 30 minutes' range, with volume and the market (QQQ) agreeing
  B  GAP        stocks that opened with a big gap: follow the gap (go) or bet against it (fade)
  C  RS         at a set time, buy the stocks strongest vs. QQQ since the open (short the weakest)
  D  MEANREV    stock far below its VWAP in an uptrend: buy, sell when it gets back to VWAP
  E  LASTHOUR   at 15:00 follow the day's direction of the strongest movers until 15:55

Uses the data and helpers of daytrader_backtest.py (same folder). Run:
    python strategies.py            (downloads if needed, then tests)
    python strategies.py --offline  (only the files already in data/)
Writes strategies_results.txt.
"""
import itertools
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import daytrader_backtest as base  # noqa: E402

EUR = base.EURUSD
SLIP = base.SLIPPAGE
STAKE = base.STAKE_EUR
MAX_OPEN = 3
MAX_TRADES_DAY = 6
DAY_STOP = 40.0
SLOTS = base.SLOTS
IDX = base.SLOT_INDEX


def j_of(hm):
    return IDX[hm]


# ---------------------------------------------------------------- signals
# each family returns, for one day, a list of candidate entries (j, sym, side, stop_price_hint, tag)
# all decided with bars up to and including j; the trade fills at bar j+1's open.

def fam_orb(day, p):
    out = []
    M = day["M"]
    n = p["range_bars"]
    for sym, P in day["S"].items():
        bars = P["bars"]
        hi = max(b["h"] for b in bars[:n]); lo = min(b["l"] for b in bars[:n])
        for j in range(n, j_of(1500)):
            b = bars[j]
            if b["v"] < p["volx"] * P["slot"][j]:
                continue
            mk = (M["bars"][j]["c"] - M["vw"][j]) if M else 0
            if b["c"] > hi * 1.001 and bars[j - 1]["c"] <= hi * 1.001 and mk >= 0 and b["c"] > P["vw"][j]:
                out.append((j, sym, 1, (hi + lo) / 2 if p["stop"] == "mid" else lo, "orb long")); break
            if p["short"] and b["c"] < lo * 0.999 and bars[j - 1]["c"] >= lo * 0.999 and mk <= 0 and b["c"] < P["vw"][j]:
                out.append((j, sym, -1, (hi + lo) / 2 if p["stop"] == "mid" else hi, "orb short")); break
    return out


def fam_gap(day, p):
    out = []
    j = 2  # decide at 9:45 (after three bars)
    for sym, P in day["S"].items():
        if P["prev_close"] is None:
            continue
        bars = P["bars"]; o = bars[0]["o"]; gap = o / P["prev_close"] - 1
        if abs(gap) < p["gap"]:
            continue
        side_gap = 1 if gap > 0 else -1
        held = (bars[j]["c"] - o) * side_gap > 0          # first 15 min continued the gap
        if p["mode"] == "go" and held:
            side = side_gap
        elif p["mode"] == "fade" and not held:
            side = -side_gap
        else:
            continue
        lo = min(b["l"] for b in bars[:3]); hi = max(b["h"] for b in bars[:3])
        out.append((j, sym, side, lo if side > 0 else hi, "gap " + p["mode"]))
    return out


def fam_rs(day, p):
    j = j_of(p["at"]) - 1
    M = day["M"]
    if not M:
        return []
    mret = M["bars"][j]["c"] / M["bars"][0]["o"] - 1
    scores = []
    for sym, P in day["S"].items():
        r = P["bars"][j]["c"] / P["bars"][0]["o"] - 1 - mret
        if P["bars"][j]["c"] > P["vw"][j]:
            scores.append((r, sym))
    scores.sort(reverse=True)
    out = []
    for r, sym in scores[:p["k"]]:
        if r >= p["min_rs"]:
            P = day["S"][sym]
            out.append((j, sym, 1, None, "rs long"))
    if p["short"]:
        weak = []
        for sym, P in day["S"].items():
            r = P["bars"][j]["c"] / P["bars"][0]["o"] - 1 - mret
            if P["bars"][j]["c"] < P["vw"][j]:
                weak.append((r, sym))
        weak.sort()
        for r, sym in weak[:p["k"]]:
            if r <= -p["min_rs"]:
                out.append((j, sym, -1, None, "rs short"))
    return out


def fam_meanrev(day, p):
    out = []
    M = day["M"]
    for sym, P in day["S"].items():
        if p["trend"] and P["trend"] < 0:
            continue
        bars = P["bars"]
        for j in range(j_of(1000), j_of(1500)):
            a = P["atr"][j]; c = bars[j]["c"]
            if M and (M["bars"][j]["c"] / M["bars"][0]["o"] - 1) < -0.01:
                continue                                   # no knife-catching on a falling market day
            if c < P["vw"][j] - p["dev"] * a and c > bars[j]["o"]:   # far below VWAP and a green bar
                out.append((j, sym, 1, None, "meanrev")); break
    return out


def fam_lasthour(day, p):
    j = j_of(1500) - 1
    M = day["M"]
    if not M:
        return []
    mret = M["bars"][j]["c"] / M["bars"][0]["o"] - 1
    if abs(mret) < p["mkt_move"]:
        return []
    side = 1 if mret > 0 else -1
    cand = []
    for sym, P in day["S"].items():
        r = P["bars"][j]["c"] / P["bars"][0]["o"] - 1
        if r * side > 0 and (P["bars"][j]["c"] - P["vw"][j]) * side > 0:
            cand.append((abs(r), sym))
    cand.sort(reverse=True)
    return [(j, sym, side, None, "last hour") for _, sym in cand[:p["k"]]]


FAMILIES = {
    "A ORB30": (fam_orb, dict(range_bars=[6], volx=[1.2, 1.8], stop=["mid", "far"], short=[True, False],
                              exit=["close", "trail", "2R"])),
    "B GAP": (fam_gap, dict(gap=[0.02, 0.04], mode=["go", "fade"], exit=["close", "vwap", "trail", "2R"])),
    "C RS": (fam_rs, dict(at=[1000, 1030, 1100], k=[1, 3], min_rs=[0.005, 0.015], short=[True, False],
                          exit=["close", "trail"])),
    "D MEANREV": (fam_meanrev, dict(dev=[1.5, 2.5, 3.5], trend=[True, False], exit=["vwap", "close"])),
    "E LASTHOUR": (fam_lasthour, dict(mkt_move=[0.003, 0.008], k=[1, 3], exit=["close"])),
}
COMMON = dict(lev=[5, 10], fee=[1.0, 0.35], stop_atr=[1.5, 3.0])


# ---------------------------------------------------------------- simulate one setting over some days
def simulate(fam, p, days_list):
    trades = []
    for d, day in days_list:
        cands = sorted(fam(day, p), key=lambda x: x[0])
        open_pos, n_today, pnl = [], 0, 0.0
        ci = 0
        for j in range(1, 78):
            hm = SLOTS[j]
            # manage open positions on bar j
            for pos in list(open_pos):
                P = day["S"][pos["sym"]]; b = P["bars"][j]; s = pos["s"]; ex = None
                if (s > 0 and b["l"] <= pos["st"]) or (s < 0 and b["h"] >= pos["st"]):
                    ex = min(b["o"], pos["st"]) if s > 0 else max(b["o"], pos["st"]); why = "stop"
                elif pos["tg"] is not None and ((s > 0 and b["h"] >= pos["tg"]) or (s < 0 and b["l"] <= pos["tg"])):
                    ex = max(b["o"], pos["tg"]) if s > 0 else min(b["o"], pos["tg"]); why = "target"
                elif p["exit"] == "vwap" and j > pos["j"] and (b["c"] - P["vw"][j]) * s >= 0:
                    ex = b["c"]; why = "vwap"
                elif hm >= 1555:
                    ex = b["c"]; why = "15:55"
                if ex is not None:
                    ex *= (1 - SLIP * s)
                    net = ((ex - pos["e"]) * pos["q"] * s - 2 * p["fee"]) / EUR
                    gross = (ex - pos["e"]) * pos["q"] * s / EUR
                    trades.append(dict(date=str(d), sym=pos["sym"], tag=pos["tag"], eur=net, gross=gross, why=why))
                    pnl += net; open_pos.remove(pos); continue
                if p["exit"] == "trail":
                    pos["best"] = max(pos["best"], b["h"]) if s > 0 else min(pos["best"], b["l"])
                    if not pos["mv"] and (b["c"] - pos["e"]) * s >= (2 * p["fee"] + 3 * EUR) / pos["q"]:
                        pos["mv"] = True
                    if pos["mv"]:
                        cand = pos["best"] - s * 5 * EUR / pos["q"]
                        pos["st"] = max(pos["st"], cand) if s > 0 else min(pos["st"], cand)
            # fill candidates decided on bar j-1
            while ci < len(cands) and cands[ci][0] < j - 1:
                ci += 1
            while ci < len(cands) and cands[ci][0] == j - 1:
                cj, sym, side, hint, tag = cands[ci]; ci += 1
                if hm >= 1530 or len(open_pos) >= MAX_OPEN or n_today >= MAX_TRADES_DAY or pnl <= -DAY_STOP:
                    continue
                if any(o["sym"] == sym for o in open_pos):
                    continue
                P = day["S"][sym]; b = P["bars"][j]
                px = b["o"] * (1 + SLIP * side); a = P["atr"][cj]
                st = px - side * p["stop_atr"] * a
                if hint is not None and (hint - px) * side < 0:
                    st = hint if abs(px - hint) < abs(px - st) * 2 else st
                if (px - st) * side <= 0:
                    continue
                tg = px + side * 2 * abs(px - st) if p["exit"] == "2R" else None
                q = STAKE * EUR * p["lev"] / px
                open_pos.append(dict(sym=sym, s=side, e=px, q=q, st=st, tg=tg, best=px, mv=False, tag=tag, j=j))
                n_today += 1
    return trades


def summ(tr, nd):
    if not tr:
        return dict(trades=0, per_day=0.0, before_fees_per_day=0.0, win=0, worst_day=0.0)
    days = defaultdict(float)
    for t in tr:
        days[t["date"]] += t["eur"]
    return dict(trades=len(tr), per_day=round(sum(t["eur"] for t in tr) / nd, 2),
                before_fees_per_day=round(sum(t["gross"] for t in tr) / nd, 2),
                win=round(100 * sum(1 for t in tr if t["eur"] > 0) / len(tr)),
                worst_day=round(min(days.values()), 2))


def build_days(all_days, mdays, dates):
    prep = base.prepare(all_days, dates)
    mprep = {d: v for (s, d), v in base.prepare({base.MARKET: mdays}, dates).items()} if mdays else {}
    byd = defaultdict(dict)
    for (sym, d), P in prep.items():
        ds = sorted(all_days[sym])
        k = ds.index(d)
        P["prev_close"] = all_days[sym][ds[k - 1]][-1]["c"] if k else None
        byd[d][sym] = P
    return [(d, dict(S=byd[d], M=mprep.get(d))) for d in sorted(byd)]


def main():
    offline = "--offline" in sys.argv
    keys = None if offline else base.load_keys()
    all_days = {}
    for sym in base.SYMBOLS + [base.MARKET]:
        path = os.path.join(base.DATA, sym + ".json")
        if offline:
            if not os.path.exists(path):
                continue
            payload = json.load(open(path))
        else:
            print("data", sym, flush=True)
            payload = base.get_bars(sym, keys)
        dd = base.to_days(payload)
        if dd:
            all_days[sym] = dd
    mdays = all_days.pop(base.MARKET, {})
    dates = sorted(set(d for v in all_days.values() for d in v) | set(mdays))
    days = build_days(all_days, mdays, dates)
    cut = int(len(days) * (1 - base.TEST_SHARE))
    train, test = days[:cut], days[cut:]
    lines = []

    def say(s=""):
        print(s, flush=True); lines.append(s)

    say("Strategy types test: %d stocks, TRAIN %s..%s (%d days), TEST %s..%s (%d days)" % (
        len(all_days), train[0][0], train[-1][0], len(train), test[0][0], test[-1][0], len(test)))
    say("EUR %.0f per trade; fee 1.00 = USD 1 per order, 0.35 = low-fee broker. Only TEST counts.\n" % STAKE)
    both_positive = []
    for name, (fam, grid) in FAMILIES.items():
        g = dict(grid); g.update(COMMON)
        ks = list(g)
        res = []
        for combo in itertools.product(*g.values()):
            p = dict(zip(ks, combo))
            tr = simulate(fam, p, train)
            if len(tr) < 10:
                continue
            res.append((sum(t["eur"] for t in tr), p))
        res.sort(key=lambda x: -x[0])
        say("== %s  (%d settings tried) ==" % (name, len(res)))
        for tot, p in res[:3]:
            a = summ(simulate(fam, p, train), len(train)); b = summ(simulate(fam, p, test), len(test))
            say("  %s" % json.dumps(p))
            say("    TRAIN %s" % json.dumps(a))
            say("    TEST  %s" % json.dumps(b))
            if a["per_day"] > 0 and b["per_day"] > 0:
                both_positive.append((b["per_day"], name, p, a, b))
        npos = 0
        for tot, p in res:
            if tot > 0:
                npos += 1
        say("  settings positive on TRAIN: %d of %d" % (npos, len(res)))
        say()
    say("== Positive on BOTH train and test (top 3 of each type) ==")
    if not both_positive:
        say("  none")
    for b, name, p, a, t in sorted(both_positive, key=lambda x: -x[0]):
        say("  %s %s -> TRAIN %.2f/day, TEST %.2f/day, %d test trades" % (name, json.dumps(p), a["per_day"], t["per_day"], t["trades"]))
    with open(os.path.join(base.HERE, "strategies_results.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
