#!/usr/bin/env python3
"""
10,000-method search for the Day-Trader bot.

A "method" = one entry type + its numbers + filters + exit rule + how long to hold
(same day, or 1-5 days) + leverage. 10,000 different methods are drawn at random
from these building blocks and each is replayed over 12 months of real 5-minute data.

Honest scoring (walk-forward): each month the bot may only use the methods that did
best in the 3 months BEFORE it, then it trades that month with them. Only those months
count. The best method "in hindsight" is printed too, to show how much luck can fake.

Usage
  python search10k.py data                 download the data (needs Alpaca keys)
  python search10k.py run  K N             run part K of N (configs i with i % N == K)
  python search10k.py merge                combine the parts, pick, write search_results.txt
  python search10k.py selftest             tiny offline run on whatever is in data/
"""
import json
import os
import random
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import daytrader_backtest as base  # noqa: E402

N_METHODS = 10000
UNIVERSE = """AAPL MSFT NVDA AMZN META GOOGL TSLA AVGO AMD NFLX ORCL CRM ADBE INTC QCOM TXN MU AMAT LRCX KLAC
MRVL ARM SMCI DELL HPQ IBM CSCO ANET PANW CRWD ZS NET DDOG SNOW MDB PLTR SHOP UBER LYFT ABNB DASH BKNG EXPE
MAR HLT RCL CCL NCLH DAL UAL AAL LUV BA GE CAT DE HON MMM RTX LMT NOC GD UPS FDX JPM BAC WFC C GS MS SCHW
AXP V MA PYPL COIN HOOD SOFI AFRM MSTR RIOT MARA XOM CVX COP OXY SLB HAL DVN EOG MPC VLO PSX LLY UNH JNJ
PFE MRK ABBV AMGN GILD BMY REGN VRTX MRNA BIIB ISRG TMO DHR ABT MDT CVS CI HUM WMT COST TGT HD LOW NKE
SBUX MCD CMG LULU DIS CMCSA T VZ TMUS KO PEP PG RBLX U SPOT PINS SNAP TTD ROKU ZM DOCU TWLO OKTA SE MELI
BABA PDD JD NIO RIVN LCID F GM TSM ASML""".split()
base.SYMBOLS = UNIVERSE
SEED = 7
EUR = base.EURUSD
SLIP = base.SLIPPAGE
STAKE = base.STAKE_EUR
SLOTS = base.SLOTS
IDX = base.SLOT_INDEX
FEES = [1.0, 0.35]           # USD per order, applied afterwards
HERE = base.HERE
PARTS = os.path.join(HERE, "parts")
RESULTS = "search_results.txt"


# ------------------------------------------------------------------ data
def load_all(download):
    keys = base.load_keys() if download else None
    all_days = {}
    for sym in base.SYMBOLS + [base.MARKET]:
        path = os.path.join(base.DATA, sym + ".json")
        if download:
            print("data", sym, flush=True)
            payload = base.get_bars(sym, keys)
        elif os.path.exists(path):
            payload = json.load(open(path))
        else:
            continue
        dd = base.to_days(payload)
        if dd:
            all_days[sym] = dd
    mdays = all_days.pop(base.MARKET, {})
    dates = sorted(set(d for v in all_days.values() for d in v) | set(mdays))
    prep = base.prepare(all_days, dates)
    mprep = {d: v for (s, d), v in base.prepare({base.MARKET: mdays}, dates).items()} if mdays else {}
    S = defaultdict(dict)
    for (sym, d), P in prep.items():
        ds = sorted(all_days[sym]); k = ds.index(d)
        P["prev_close"] = all_days[sym][ds[k - 1]][-1]["c"] if k else None
        closes = [all_days[sym][x][-1]["c"] for x in ds[max(0, k - 20):k]]
        P["ret5"] = closes[-1] / closes[-6] - 1 if len(closes) >= 6 else 0.0
        P["ret20"] = closes[-1] / closes[0] - 1 if len(closes) >= 20 else 0.0
        S[d][sym] = P
    days = sorted(S)
    return days, S, mprep


# ------------------------------------------------------------------ methods
def draw_methods(n, seed=SEED):
    rnd = random.Random(seed)
    fams = ["orb", "gap", "rs", "meanrev", "vwap_reclaim", "mom_open", "swing_mom", "swing_pullback"]
    seen, out = set(), []
    while len(out) < n:
        f = rnd.choice(fams)
        swing = f.startswith("swing") or rnd.random() < 0.25
        m = dict(fam=f,
                 hold=rnd.choice([1, 2, 3, 5]) if swing else 0,                 # 0 = out by 15:55
                 lev=rnd.choice([1, 2, 3]) if swing else rnd.choice([3, 5, 10]),
                 start=rnd.choice([945, 1000, 1030, 1100]),
                 regime=rnd.choice([0, 1]),            # trade only with QQQ's 20-day direction
                 mkt_now=rnd.choice([0, 1]),           # and with QQQ vs its VWAP right now
                 vwap_side=rnd.choice([0, 1]),         # stock on the right side of its VWAP
                 volx=rnd.choice([0, 1.2, 1.5, 2.0]),
                 stop_atr=rnd.choice([1.0, 1.5, 2.0, 3.0]),
                 target_r=rnd.choice([0, 0, 1.5, 2, 3]),
                 trail=rnd.choice([0, 0, 1]),
                 short=rnd.choice([0, 1]),
                 max_open=rnd.choice([1, 3]),
                 max_new=rnd.choice([1, 3, 6]))
        if f == "orb":
            m.update(range_bars=rnd.choice([3, 6, 12]))
        elif f == "gap":
            m.update(gap=rnd.choice([0.01, 0.02, 0.03, 0.05]), mode=rnd.choice(["go", "fade"]))
        elif f == "rs":
            m.update(at=rnd.choice([1000, 1030, 1100, 1200, 1400]), k=rnd.choice([1, 2, 3, 5]),
                     min_rs=rnd.choice([0.0, 0.005, 0.01, 0.02]))
        elif f == "meanrev":
            m.update(dev=rnd.choice([1.0, 1.5, 2.0, 3.0]), vexit=rnd.choice([0, 1]))
        elif f == "vwap_reclaim":
            m.update(below_bars=rnd.choice([2, 4, 8]))
        elif f == "mom_open":
            m.update(at=rnd.choice([1000, 1030, 1100, 1300]), move=rnd.choice([0.01, 0.02, 0.03]))
        elif f == "swing_mom":
            m.update(look=rnd.choice(["ret5", "ret20"]), k=rnd.choice([1, 2, 3, 5]), at=rnd.choice([1000, 1530]))
        elif f == "swing_pullback":
            m.update(drop=rnd.choice([0.01, 0.02, 0.03]), at=rnd.choice([1430, 1530]))
        if f in ("meanrev", "vwap_reclaim", "swing_pullback"):
            m["short"] = 0
        key = json.dumps(m, sort_keys=True)
        if key not in seen:
            seen.add(key); out.append(m)
    return out


# ------------------------------------------------------------------ signals for one day
def signals(m, d, S, M):
    """List of (j, sym, side, stop_hint). Decided with bars up to j; filled at bar j+1."""
    f = m["fam"]; out = []
    mt = M["trend"] if (M and m["regime"]) else 0

    def ok(P, j, side):
        if mt and side != mt:
            return False
        if m["mkt_now"] and M and (M["bars"][j]["c"] - M["vw"][j]) * side < 0:
            return False
        if m["vwap_side"] and (P["bars"][j]["c"] - P["vw"][j]) * side < 0:
            return False
        if m["volx"] and P["bars"][j]["v"] < m["volx"] * P["slot"][j]:
            return False
        return True

    sides = (1, -1) if m["short"] else (1,)
    j0 = IDX[m["start"]] - 1
    jend = IDX[1530] - 1
    if f == "orb":
        n = m["range_bars"]
        for sym, P in S.items():
            b = P["bars"]; hi = max(x["h"] for x in b[:n]); lo = min(x["l"] for x in b[:n])
            for j in range(max(n, j0), jend):
                c = b[j]["c"]
                if c > hi * 1.001 and b[j - 1]["c"] <= hi * 1.001 and ok(P, j, 1):
                    out.append((j, sym, 1, lo)); break
                if -1 in sides and c < lo * 0.999 and b[j - 1]["c"] >= lo * 0.999 and ok(P, j, -1):
                    out.append((j, sym, -1, hi)); break
    elif f == "gap":
        j = max(2, j0)
        for sym, P in S.items():
            if not P["prev_close"]:
                continue
            b = P["bars"]; g = b[0]["o"] / P["prev_close"] - 1
            if abs(g) < m["gap"]:
                continue
            sg = 1 if g > 0 else -1
            held = (b[j]["c"] - b[0]["o"]) * sg > 0
            side = sg if (m["mode"] == "go" and held) else (-sg if (m["mode"] == "fade" and not held) else 0)
            if side and side in sides and ok(P, j, side):
                out.append((j, sym, side, None))
    elif f in ("rs", "mom_open"):
        j = IDX[m["at"]] - 1
        mret = (M["bars"][j]["c"] / M["bars"][0]["o"] - 1) if M else 0.0
        sc = []
        for sym, P in S.items():
            r = P["bars"][j]["c"] / P["bars"][0]["o"] - 1
            sc.append((r - mret if f == "rs" else r, sym))
        sc.sort(reverse=True)
        if f == "rs":
            for r, sym in sc[:m["k"]]:
                if r >= m["min_rs"] and ok(S[sym], j, 1):
                    out.append((j, sym, 1, None))
            if -1 in sides:
                for r, sym in sc[::-1][:m["k"]]:
                    if r <= -m["min_rs"] and ok(S[sym], j, -1):
                        out.append((j, sym, -1, None))
        else:
            for r, sym in sc:
                if r >= m["move"] and ok(S[sym], j, 1):
                    out.append((j, sym, 1, None))
                elif -1 in sides and r <= -m["move"] and ok(S[sym], j, -1):
                    out.append((j, sym, -1, None))
    elif f == "meanrev":
        for sym, P in S.items():
            b = P["bars"]
            for j in range(j0, jend):
                if b[j]["c"] < P["vw"][j] - m["dev"] * P["atr"][j] and b[j]["c"] > b[j]["o"] and ok(dict(P, vw=[0] * 78), j, 1):
                    out.append((j, sym, 1, None)); break
    elif f == "vwap_reclaim":
        k = m["below_bars"]
        for sym, P in S.items():
            b = P["bars"]
            for j in range(max(j0, k + 1), jend):
                if b[j]["c"] > P["vw"][j] and all(b[x]["c"] < P["vw"][x] for x in range(j - k, j)) and ok(P, j, 1):
                    out.append((j, sym, 1, min(x["l"] for x in b[j - k:j + 1]))); break
    elif f == "swing_mom":
        j = IDX[m["at"]] - 1
        sc = sorted(((P[m["look"]], sym) for sym, P in S.items()), reverse=True)
        for r, sym in sc[:m["k"]]:
            if r > 0 and ok(S[sym], j, 1):
                out.append((j, sym, 1, None))
        if -1 in sides:
            for r, sym in sc[::-1][:m["k"]]:
                if r < 0 and ok(S[sym], j, -1):
                    out.append((j, sym, -1, None))
    elif f == "swing_pullback":
        j = IDX[m["at"]] - 1
        for sym, P in S.items():
            if P["trend"] > 0 and P["prev_close"] and P["bars"][j]["c"] / P["prev_close"] - 1 <= -m["drop"] and ok(P, j, 1):
                out.append((j, sym, 1, None))
    return sorted(out, key=lambda x: x[0])


# ------------------------------------------------------------------ replay one method
def replay(m, days, S, MP, keep_trades=False):
    """Returns per-day gross EUR and trade counts (fees applied later), and optionally the trades."""
    day_gross = defaultdict(float); day_n = defaultdict(int); trades = []
    open_pos = []
    for di, d in enumerate(days):
        Sd = S[d]; M = MP.get(d)
        cands = signals(m, d, Sd, M); ci = 0; new_today = 0
        for j in range(78):
            hm = SLOTS[j]
            for pos in list(open_pos):
                P = Sd.get(pos["sym"])
                if P is None:
                    continue
                b = P["bars"][j]; s = pos["s"]; ex = None
                if (s > 0 and b["l"] <= pos["st"]) or (s < 0 and b["h"] >= pos["st"]):
                    ex = min(b["o"], pos["st"]) if s > 0 else max(b["o"], pos["st"])
                elif pos["tg"] is not None and ((s > 0 and b["h"] >= pos["tg"]) or (s < 0 and b["l"] <= pos["tg"])):
                    ex = max(b["o"], pos["tg"]) if s > 0 else min(b["o"], pos["tg"])
                elif m["fam"] == "meanrev" and m.get("vexit") and j > pos["j"] and di == pos["di"] and b["c"] >= P["vw"][j]:
                    ex = b["c"]
                elif hm >= 1555 and di >= pos["di"] + m["hold"]:
                    ex = b["c"]
                if ex is not None:
                    ex *= (1 - SLIP * s)
                    g = (ex - pos["e"]) * pos["q"] * s / EUR
                    day_gross[d] += g; day_n[d] += 1
                    if keep_trades:
                        trades.append((str(pos["d"]), pos["sym"], s, round(g, 2), str(d)))
                    open_pos.remove(pos); continue
                if m["trail"]:
                    pos["best"] = max(pos["best"], b["h"]) if s > 0 else min(pos["best"], b["l"])
                    if not pos["mv"] and (b["c"] - pos["e"]) * s >= (2 + 3 * EUR) / pos["q"]:
                        pos["mv"] = True
                    if pos["mv"]:
                        c2 = pos["best"] - s * 5 * EUR / pos["q"]
                        pos["st"] = max(pos["st"], c2) if s > 0 else min(pos["st"], c2)
            while ci < len(cands) and cands[ci][0] < j - 1:
                ci += 1
            while ci < len(cands) and cands[ci][0] == j - 1:
                cj, sym, side, hint = cands[ci]; ci += 1
                if hm > 1530 or len(open_pos) >= m["max_open"] or new_today >= m["max_new"]:
                    continue
                if any(p["sym"] == sym for p in open_pos):
                    continue
                P = Sd[sym]; px = P["bars"][j]["o"] * (1 + SLIP * side)
                st = px - side * m["stop_atr"] * P["atr"][cj] * (2.5 if m["hold"] else 1.0)
                if hint is not None and (hint - px) * side < 0 and abs(px - hint) < abs(px - st):
                    st = hint
                if (px - st) * side <= 0:
                    continue
                tg = px + side * m["target_r"] * abs(px - st) if m["target_r"] else None
                open_pos.append(dict(sym=sym, s=side, e=px, q=STAKE * EUR * m["lev"] / px, st=st, tg=tg,
                                     best=px, mv=False, j=j, di=di, d=d))
                new_today += 1
    return day_gross, day_n, trades


def month_of(d):
    return "%d-%02d" % (d.year, d.month)


# ------------------------------------------------------------------ commands
def cmd_run(k, n):
    days, S, MP = load_all(False)
    methods = draw_methods(N_METHODS)
    os.makedirs(PARTS, exist_ok=True)
    out = {}
    for i, m in enumerate(methods):
        if i % n != k:
            continue
        g, c, _ = replay(m, days, S, MP)
        mg, mn = defaultdict(float), defaultdict(int)
        for d in days:
            mg[month_of(d)] += g.get(d, 0.0); mn[month_of(d)] += c.get(d, 0)
        out[i] = dict(g={x: round(v, 2) for x, v in mg.items()}, n=dict(mn))
        if len(out) % 100 == 0:
            print("part %d: %d done" % (k, len(out)), flush=True)
    json.dump(out, open(os.path.join(PARTS, "part%02d.json" % k), "w"))


def cmd_merge():
    days, S, MP = load_all(False)
    methods = draw_methods(N_METHODS)
    table = {}
    for fn in sorted(os.listdir(PARTS)):
        if fn.endswith(".json"):
            table.update({int(k): v for k, v in json.load(open(os.path.join(PARTS, fn))).items()})
    months = sorted(set(month_of(d) for d in days))
    mdays = defaultdict(list)
    for d in days:
        mdays[month_of(d)].append(d)
    lines = []

    def say(s=""):
        print(s, flush=True); lines.append(s)

    say("10,000-method search: %d methods replayed, %d stocks, %s..%s (%d trading days)" % (
        len(table), len(set(sym for d in S for sym in S[d])), days[0], days[-1], len(days)))
    say("EUR %.0f per trade. Same-day trades up to x10, multi-day trades up to x3 (overnight gaps)." % STAKE)
    say("")
    for fee in FEES:
        fe = 2 * fee / EUR

        def net(i, mo):
            r = table[i]; return r["g"].get(mo, 0.0) - fe * r["n"].get(mo, 0)

        say("=================  fee USD %.2f per order  =================" % fee)
        full = sorted(((sum(net(i, mo) for mo in months[1:]), i) for i in table), reverse=True)
        pos = sum(1 for t, i in full if t > 0)
        say("In hindsight (whole year, the kind of number that fools people):")
        say("  methods with a profit: %d of %d; best one: EUR %.0f = EUR %.2f per day" % (
            pos, len(full), full[0][0], full[0][0] / max(1, sum(len(mdays[x]) for x in months[1:]))))
        say("")
        for topn in (1, 5, 20):
            say("Walk-forward, the bot uses the %d best methods of the previous 3 months each month:" % topn)
            tot = 0.0; ndays = 0
            for mi in range(4, len(months)):
                window = months[mi - 3:mi]
                sc = []
                for i in table:
                    n_ = sum(table[i]["n"].get(x, 0) for x in window)
                    if n_ < 15:
                        continue
                    sc.append((sum(net(i, x) for x in window), i))
                sc.sort(reverse=True)
                chosen = [i for s_, i in sc[:topn] if s_ > 0]
                mo = months[mi]
                if not chosen:
                    say("  %s  sat out (nothing made money before)" % mo); ndays += len(mdays[mo]); continue
                r = sum(net(i, mo) for i in chosen) / len(chosen)     # stake split across the chosen methods
                tot += r; ndays += len(mdays[mo])
                desc = describe(methods[chosen[0]])
                say("  %s  EUR %8.2f   (EUR %6.2f/day)   top pick: %s" % (mo, r, r / len(mdays[mo]), desc))
            say("  TOTAL EUR %.2f over %d days = EUR %.2f per day" % (tot, ndays, tot / max(1, ndays)))
            say("")
        say("Top 10 methods in hindsight (NOT proof, shown so you can see what they are):")
        for t, i in full[:10]:
            say("  EUR %8.0f  %s" % (t, describe(methods[i])))
        say("")
    with open(os.path.join(HERE, RESULTS), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def describe(m):
    keys = [k for k in m if k not in ("fam",)]
    return m["fam"] + " " + ", ".join("%s=%s" % (k, m[k]) for k in keys)


def main():
    global N_METHODS
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    c = sys.argv[1]
    if c == "data":
        from concurrent.futures import ThreadPoolExecutor
        keys = base.load_keys()
        syms = base.SYMBOLS + [base.MARKET]
        def one(sym):
            try:
                n = len(base.get_bars(sym, keys)["bars"])
                print("data %-5s %6d bars" % (sym, n), flush=True)
            except Exception as e:                       # one bad symbol must not stop the rest
                print("data %-5s FAILED: %s" % (sym, e), flush=True)
        with ThreadPoolExecutor(max_workers=3) as ex:
            list(ex.map(one, syms))
    elif c == "run":
        cmd_run(int(sys.argv[2]), int(sys.argv[3]))
    elif c == "merge":
        cmd_merge()
    elif c == "selftest":
        N_METHODS = int(sys.argv[2]) if len(sys.argv) > 2 else 60
        cmd_run(0, 1); cmd_merge()


if __name__ == "__main__":
    main()
