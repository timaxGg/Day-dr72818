#!/usr/bin/env python3
"""
Improvement lab: run one rule set on 2023-2025 history, split into
  LEARN  2024-01 .. 2025-06   (study mistakes here)
  CHECK  2025-07 .. 2025-11   (do the changes also work here?)
  LOCKED 2023-02 .. 2023-12   (only for the final one-time test: python lab.py final)
and explain where the money is won and lost (by feature buckets).

Costs: Interactive Brokers tiered (USD 0.0035/share, min 0.35 per order), slippage 0.05% per fill.
Account EUR 2,000; risk per trade and max position size come from the rule set.
"""
import datetime as dt
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import daytrader_backtest as base  # noqa: E402

EUR = base.EURUSD
SLIP = 0.0005
HIST = os.path.join(base.HERE, "data_hist")
PERIODS = dict(LEARN=(dt.date(2024, 1, 1), dt.date(2025, 6, 30)),
               CHECK=(dt.date(2025, 7, 1), dt.date(2025, 11, 30)),
               LOCKED=(dt.date(2023, 2, 1), dt.date(2023, 12, 31)))


# ------------------------------------------------------------------ data + daily context
def load(folder=HIST):
    raw = {}
    for fn in sorted(os.listdir(folder)):
        if fn.endswith(".json"):
            dd = base.to_days(json.load(open(os.path.join(folder, fn))))
            if len(dd) > 30:
                raw[fn[:-5]] = dd
    ctx = {}
    for sym, dd in raw.items():
        ds = sorted(dd); daily = []
        for d in ds:
            b = dd[d]
            daily.append(dict(o=b[0]["o"], h=max(x["h"] for x in b), l=min(x["l"] for x in b), c=b[-1]["c"],
                              v=sum(x["v"] for x in b), v5=b[0]["v"]))
        for k, d in enumerate(ds):
            if k < 21:
                continue
            past = daily[k - 14:k]
            atr = sum(max(x["h"] - x["l"], abs(x["h"] - y["c"]), abs(x["l"] - y["c"]))
                      for y, x in zip(daily[k - 15:k - 1], past)) / 14
            c20 = [x["c"] for x in daily[k - 20:k]]
            ctx[(sym, d)] = dict(atr=atr, avgvol=sum(x["v"] for x in past) / 14, avgv5=sum(x["v5"] for x in past) / 14,
                                 prev=daily[k - 1], trend20=1 if c20[-1] > sum(c20) / 20 else -1,
                                 ret5=c20[-1] / c20[-6] - 1)
    return raw, ctx


def fee_usd(notional_usd, price):
    return max(0.35, 0.0035 * max(1.0, notional_usd / price))


# ------------------------------------------------------------------ candidates (stocks in play, ORB)
def candidates(raw, ctx, d, R):
    M = raw.get(base.MARKET, {}).get(d)
    mdir = 0; mgap = 0.0
    if M:
        mdir = 1 if M[R["range"] // 5 - 1]["c"] > M[0]["o"] else -1
        mc = ctx.get((base.MARKET, d))
        if mc:
            mgap = M[0]["o"] / mc["prev"]["c"] - 1
    out = []
    n = R["range"] // 5
    for sym, dd in raw.items():
        if sym == base.MARKET or d not in dd or (sym, d) not in ctx:
            continue
        C = ctx[(sym, d)]; b = dd[d]
        if b[0]["o"] < R["min_price"] or C["avgvol"] < 1e6 or C["atr"] < 0.5 or C["avgv5"] <= 0:
            continue
        rv = b[0]["v"] / C["avgv5"]
        if rv < R["min_rv"]:
            continue
        o, c = b[0]["o"], b[n - 1]["c"]
        side = 1 if c > o else (-1 if c < o else 0)
        if not side or (R["long_only"] and side < 0):
            continue
        gap = o / C["prev"]["c"] - 1
        body = abs(c - o) / C["atr"]
        f = dict(sym=sym, side=side, rv=rv, gap=gap * side, body=body, atrpct=C["atr"] / o,
                 mkt=mdir * side, mgap=mgap * side, trend=C["trend20"] * side, ret5=C["ret5"] * side,
                 dow=d.weekday(), price=o)
        ok = True
        for k, (lo, hi) in R["filters"].items():
            if not (lo <= f[k] <= hi):
                ok = False; break
        if ok:
            out.append(f)
    out.sort(key=lambda x: -x["rv"])
    return out[:R["top"]]


def trade(b, f, C, R):
    """Simulate one ORB trade on 5-minute bars. Returns dict or None."""
    n = R["range"] // 5; side = f["side"]
    hi = max(x["h"] for x in b[:n]); lo = min(x["l"] for x in b[:n])
    lvl = hi if side > 0 else lo
    last_entry = base.SLOT_INDEX[R["last_entry"]]
    for j in range(n, last_entry):
        if (side > 0 and b[j]["h"] >= lvl) or (side < 0 and b[j]["l"] <= lvl):
            fill = (max(lvl, b[j]["o"]) if side > 0 else min(lvl, b[j]["o"])) * (1 + SLIP * side)
            sd = R["stop_atr"] * C["atr"]
            if R["stop_range"]:
                sd = max(sd, abs(fill - (lo if side > 0 else hi)))
            stop = fill - side * sd
            tgt = fill + side * R["target_r"] * sd if R["target_r"] else None
            moved = False; exit_j = base.SLOT_INDEX[R["exit_time"]]
            for k in range(j, exit_j + 1):
                x = b[k]
                if k == j:
                    x = dict(o=x["c"], h=x["c"], l=x["c"], c=x["c"])
                if (side > 0 and x["l"] <= stop) or (side < 0 and x["h"] >= stop):
                    ex = min(x["o"], stop) if side > 0 else max(x["o"], stop)
                    return dict(fill=fill, exit=ex * (1 - SLIP * side), sd=sd, j=j, why="stop" if not moved else "be")
                if tgt is not None and ((side > 0 and x["h"] >= tgt) or (side < 0 and x["l"] <= tgt)):
                    ex = max(x["o"], tgt) if side > 0 else min(x["o"], tgt)
                    return dict(fill=fill, exit=ex * (1 - SLIP * side), sd=sd, j=j, why="target")
                if R["be_r"] and not moved and (x["c"] - fill) * side >= R["be_r"] * sd:
                    stop = fill + side * 0.1 * sd; moved = True
            return dict(fill=fill, exit=b[exit_j]["c"] * (1 - SLIP * side), sd=sd, j=j, why="time")
    return None


def run(raw, ctx, R, period):
    a, z = PERIODS[period]
    days = sorted(set(d for s, dd in raw.items() if s != base.MARKET for d in dd if a <= d <= z))
    trades = []
    for d in days:
        daily_loss = 0.0
        for f in candidates(raw, ctx, d, R):
            if daily_loss <= -R["day_stop"]:
                break
            b = raw[f["sym"]][d]; C = ctx[(f["sym"], d)]
            t = trade(b, f, C, R)
            if not t:
                continue
            stop_pct = t["sd"] / t["fill"]
            notional = min(R["risk"] / stop_pct, R["max_pos"])
            ret = (t["exit"] - t["fill"]) / t["fill"] * f["side"]
            fee = 2 * fee_usd(notional * EUR, t["fill"]) / EUR
            eur = notional * ret - fee
            daily_loss += eur
            trades.append(dict(f, date=d, eur=eur, r=ret / stop_pct, why=t["why"], t=base.SLOTS[t["j"]], notional=notional))
    return days, trades


def summary(days, trades):
    if not trades:
        return "no trades"
    byday = defaultdict(float); bym = defaultdict(float)
    for t in trades:
        byday[t["date"]] += t["eur"]; bym["%d-%02d" % (t["date"].year, t["date"].month)] += t["eur"]
    eq = peak = dd = 0.0
    for d in days:
        eq += byday.get(d, 0.0); peak = max(peak, eq); dd = min(dd, eq - peak)
    tot = sum(t["eur"] for t in trades); w = [t for t in trades if t["eur"] > 0]
    return ("trades %4d  win %3.0f%%  avg win %+6.2f  avg loss %+6.2f  EUR/day %+6.2f  total %+7.0f  maxDD %+6.0f  months + %d/%d"
            % (len(trades), 100 * len(w) / len(trades), sum(t["eur"] for t in w) / max(1, len(w)),
               sum(t["eur"] for t in trades if t["eur"] <= 0) / max(1, len(trades) - len(w)),
               tot / len(days), tot, dd, sum(1 for v in bym.values() if v > 0), len(bym)))


def buckets(trades, key, edges):
    rows = []
    for i in range(len(edges) - 1):
        g = [t for t in trades if edges[i] <= t[key] < edges[i + 1]]
        if g:
            rows.append("%s[%g,%g): n %d win %d%% EUR/trade %+.2f" % (key, edges[i], edges[i + 1], len(g),
                        100 * sum(1 for t in g if t["eur"] > 0) // len(g), sum(t["eur"] for t in g) / len(g)))
    return rows


def explain(trades):
    out = []
    for key, edges in (("rv", [1, 2, 3, 5, 10, 1e9]), ("gap", [-1, -0.02, 0, 0.02, 0.05, 0.1, 1]),
                       ("body", [0, 0.1, 0.2, 0.4, 1, 100]), ("atrpct", [0, 0.02, 0.03, 0.05, 1]),
                       ("mkt", [-1, 0, 1.1]), ("trend", [-1, 0, 1.1]), ("mgap", [-1, -0.005, 0, 0.005, 1]),
                       ("ret5", [-1, -0.05, 0, 0.05, 1]), ("side", [-1, 0, 1.1]), ("dow", [0, 1, 2, 3, 4, 5]),
                       ("t", [930, 940, 1000, 1030, 1100, 1600]), ("price", [0, 20, 50, 100, 300, 1e9])):
        out += buckets(trades, key, edges)
    whys = defaultdict(list)
    for t in trades:
        whys[t["why"]].append(t["eur"])
    out.append("exits: " + ", ".join("%s %d (EUR %+.0f)" % (k, len(v), sum(v)) for k, v in whys.items()))
    return out


BASE_RULES = dict(range=5, min_price=5, min_rv=1.0, long_only=False, top=20, filters={},
                  stop_atr=0.10, stop_range=False, target_r=0, be_r=0, exit_time=1555, last_entry=1100,
                  risk=10, max_pos=2000, day_stop=60)


def load_compact(path):
    import gzip
    data = json.load(gzip.open(path, "rt"))
    raw = defaultdict(dict); ctx = {}
    for k, bars in data["bars"].items():
        sym, ds = k.split("|"); d = dt.date.fromisoformat(ds)
        raw[sym][d] = [dict(o=o, h=h, l=l, c=c, v=v) for o, h, l, c, v in bars]
        ctx[(sym, d)] = data["ctx"][k]
    return dict(raw), ctx


def main():
    if "--compact" in sys.argv:
        sys.argv.remove("--compact")
        raw, ctx = load_compact(os.path.join(base.HERE, "lab_data.json.gz"))
    else:
        raw, ctx = load()
    rules = dict(BASE_RULES)
    if len(sys.argv) > 2:
        rules.update(json.loads(sys.argv[2]))
    periods = ["LOCKED"] if (len(sys.argv) > 1 and sys.argv[1] == "final") else ["LEARN", "CHECK"]
    for p in periods:
        days, tr = run(raw, ctx, rules, p)
        print("%-6s %s" % (p, summary(days, tr)))
        if p == "LEARN" and "-v" in sys.argv:
            for line in explain(tr):
                print("   ", line)


if __name__ == "__main__":
    main()
