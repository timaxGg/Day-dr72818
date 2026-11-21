#!/usr/bin/env python3
"""
Day-Trader bot - backtest on real Alpaca data
=============================================

What it does
  1. Downloads 5-minute bars for the stocks below (plus QQQ for the market filter)
     from Alpaca with YOUR keys, and saves them in a folder "data" next to this file.
  2. Replays every trading day bar by bar. The bot only sees the past: a signal on a
     bar that just closed is bought at the NEXT bar's open.
  3. Tunes the settings on the older days (TRAIN) and then checks them on the newer
     days it has never seen (TEST). Only the TEST numbers count.
  4. Prints the results and saves them to "results.txt" and "test_trades.csv".

How to run (Python 3.8 or newer, nothing to install)
  - Put your Alpaca keys in a file "alpaca_keys.txt" next to this file:
        line 1: your API key ID
        line 2: your secret key
    (or set the environment variables ALPACA_API_KEY and ALPACA_SECRET_KEY)
    Never paste the keys into a chat.
  - Open a terminal in this folder and run:
        python daytrader_backtest.py
    (on Mac/Linux maybe: python3 daytrader_backtest.py)
  - Send back the file "results.txt".

Not financial advice. A backtest shows how rules would have done in the past;
the future can be different.
"""
import datetime as dt
import itertools
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict

# ----------------------------------------------------------------- settings
SYMBOLS = ["TSLA", "NVDA", "AMD", "META", "AMZN", "NFLX", "PLTR", "AVGO", "MU", "COIN",
           "UBER", "SHOP", "AAPL", "MSFT", "GOOGL", "ORCL", "CRWD", "SMCI", "MSTR", "HOOD",
           "SNOW", "PANW", "ARM", "INTC", "BA", "DIS", "PYPL", "ABNB", "DASH", "RBLX"]
MARKET = "QQQ"                 # Nasdaq-100 fund, used as the market filter
MONTHS_BACK = 6                # how much history to download
TEST_SHARE = 0.33              # newest third of the days = TEST (never used for tuning)

STAKE_EUR = 100.0              # money per trade
EURUSD = 1.15                  # 1 EUR in USD, for converting
FEE_PER_ORDER = 1.0            # USD per order (buy and sell each pay it)
SLIPPAGE = 0.0002              # 0.02 % worse price on every fill (spread)
MAX_OPEN = 3                   # max trades open at the same time
MAX_TRADES_PER_DAY = 6
DAY_LOSS_STOP_EUR = 40.0       # bot stops for the day after losing this much
COOLDOWN_BARS = 3              # wait 15 minutes after a sale (per stock)
MIN_PRICE = 10.0

# The settings the tuner tries (on TRAIN days only)
GRID = dict(
    lev=[5, 10],
    start=[1000, 1030],
    trend=[True, False],
    market=[True, False],
    setups=[("dip", "vwd"), ("dip", "vwd", "vwr", "bd"), ("dip",), ("bo", "bd", "dip", "vwd", "vwr")],
    trig=[3, 5],
    trail=[5, 8],
    stop_atr=[1.5, 2.5],
    volx=[1.5],
)
# Our current best guess, always reported too
DEFAULT = dict(lev=10, start=1030, trend=True, market=True, setups=("dip", "vwd", "bd"),
               trig=3, trail=5, stop_atr=1.5, volx=1.5)

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
BASE = "https://data.alpaca.markets/v2/stocks/bars"


# ----------------------------------------------------------------- keys
def load_keys():
    k, s = os.environ.get("ALPACA_API_KEY"), os.environ.get("ALPACA_SECRET_KEY")
    if k and s:
        return k.strip(), s.strip()
    path = os.path.join(HERE, "alpaca_keys.txt")
    if os.path.exists(path):
        lines = [l.strip() for l in open(path, encoding="utf-8") if l.strip()]
        if len(lines) >= 2:
            return lines[0], lines[1]
    sys.exit("No Alpaca keys found. Put them in alpaca_keys.txt (line 1 key ID, line 2 secret).")


# ----------------------------------------------------------------- New York time
def _nth_sunday(year, month, n):
    d = dt.date(year, month, 1)
    d += dt.timedelta(days=(6 - d.weekday()) % 7)
    return d + dt.timedelta(weeks=n - 1)


def to_ny(utc):
    """UTC datetime -> New York local datetime (US daylight saving rules)."""
    y = utc.year
    start = dt.datetime.combine(_nth_sunday(y, 3, 2), dt.time(7))   # 2:00 EST = 7:00 UTC
    end = dt.datetime.combine(_nth_sunday(y, 11, 1), dt.time(6))    # 2:00 EDT = 6:00 UTC
    off = -4 if start <= utc.replace(tzinfo=None) < end else -5
    return utc.replace(tzinfo=None) + dt.timedelta(hours=off)


# ----------------------------------------------------------------- download
def fetch(symbol, keys, feed):
    end = dt.datetime.utcnow() - dt.timedelta(minutes=20)            # free plan: SIP older than 15 min
    start = end - dt.timedelta(days=int(MONTHS_BACK * 30.5))
    bars, token = [], None
    while True:
        q = dict(symbols=symbol, timeframe="5Min", start=start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                 end=end.strftime("%Y-%m-%dT%H:%M:%SZ"), adjustment="all", feed=feed, limit=10000)
        if token:
            q["page_token"] = token
        req = urllib.request.Request(BASE + "?" + urllib.parse.urlencode(q),
                                     headers={"APCA-API-KEY-ID": keys[0], "APCA-API-SECRET-KEY": keys[1],
                                              "User-Agent": "daytrader-backtest/1.0"})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = json.load(r)
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    time.sleep(5 * (attempt + 1)); continue
                raise
        else:
            raise RuntimeError("too many rate-limit errors")
        bars += data.get("bars", {}).get(symbol, [])
        token = data.get("next_page_token")
        time.sleep(0.35)
        if not token:
            return bars


def get_bars(symbol, keys):
    os.makedirs(DATA, exist_ok=True)
    path = os.path.join(DATA, symbol + ".json")
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < 12 * 3600:
        return json.load(open(path))
    for feed in ("sip", "iex"):
        try:
            raw = fetch(symbol, keys, feed)
            if raw:
                out = dict(feed=feed, bars=[[b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]] for b in raw])
                json.dump(out, open(path, "w"))
                return out
        except urllib.error.HTTPError as e:
            if e.code in (401, 403) and feed == "sip":
                continue
            if e.code in (401, 403):
                sys.exit("Alpaca refused the keys (HTTP %d). Check alpaca_keys.txt." % e.code)
            raise
    return dict(feed="none", bars=[])


# ----------------------------------------------------------------- prepare days
def hm_of(minutes):
    return (9 * 60 + 30 + minutes) // 60 * 100 + (9 * 60 + 30 + minutes) % 60


SLOTS = [hm_of(5 * i) for i in range(78)]
SLOT_INDEX = {s: i for i, s in enumerate(SLOTS)}


def to_days(payload):
    """-> {date: [78 bars or None]} for regular hours, missing bars forward-filled."""
    days = defaultdict(lambda: [None] * 78)
    for t, o, h, l, c, v in payload["bars"]:
        utc = dt.datetime.strptime(t[:19], "%Y-%m-%dT%H:%M:%S")
        ny = to_ny(utc)
        i = SLOT_INDEX.get(ny.hour * 100 + ny.minute)
        if i is not None:
            days[ny.date()][i] = dict(o=o, h=h, l=l, c=c, v=v)
    out = {}
    for d, bars in days.items():
        if sum(1 for b in bars if b) < 60 or bars[0] is None:
            continue                       # half days / holidays / very thin data
        last = bars[0]
        for i in range(78):
            if bars[i] is None:
                bars[i] = dict(o=last["c"], h=last["c"], l=last["c"], c=last["c"], v=0)
            last = bars[i]
        out[d] = bars
    return out


def prepare(all_days, dates):
    """Per stock and day: volume baseline (same time slot, previous 20 days), 20-day trend, VWAP, ATR."""
    prep = {}
    for sym, days in all_days.items():
        ds = [d for d in dates if d in days]
        for k, d in enumerate(ds):
            if k < 20:
                continue
            past = ds[k - 20:k]
            bars = days[d]
            if bars[0]["o"] < MIN_PRICE:
                continue
            slot = [sum(days[p][j]["v"] for p in past) / 20 for j in range(78)]
            pc = [days[p][-1]["c"] for p in past]
            vw, atr, trs, pv, vv = [], [], [], 0.0, 0.0
            for j, b in enumerate(bars):
                pv += (b["h"] + b["l"] + b["c"]) / 3 * b["v"]; vv += b["v"]
                vw.append(pv / vv if vv else b["c"])
                if j:
                    p = bars[j - 1]["c"]
                    trs.append(max(b["h"] - b["l"], abs(b["h"] - p), abs(b["l"] - p)))
                atr.append(sum(trs[-14:]) / len(trs[-14:]) if trs else max(b["h"] - b["l"], 0.01))
            prep[(sym, d)] = dict(bars=bars, slot=slot, trend=1 if pc[-1] > sum(pc) / 20 else -1,
                                  vw=vw, atr=atr, orh=max(b["h"] for b in bars[:3]),
                                  orl=min(b["l"] for b in bars[:3]))
    return prep


# ----------------------------------------------------------------- the bot
def signal_for(P, j, p):
    bars = P["bars"]; b = bars[j]; c = b["c"]; C = 0.001
    vok = b["v"] >= p["volx"] * P["slot"][j]
    vw = P["vw"]; orh, orl = P["orh"], P["orl"]
    ph = max(x["h"] for x in bars[:j])
    green, red = c > b["o"], c < b["o"]
    out = []
    S = p["setups"]
    if "bo" in S and c > orh * (1 + C) and bars[j - 1]["c"] <= orh * (1 + C) and vok: out.append((1, "breakout up"))
    if "bd" in S and c < orl * (1 - C) and bars[j - 1]["c"] >= orl * (1 - C) and vok: out.append((-1, "breakdown"))
    if "dip" in S and b["l"] <= orl * (1 + C) and c > orl * (1 + 2 * C) and green: out.append((1, "dip buy"))
    if "vwd" in S and b["l"] <= vw[j] * (1 + C) and c > vw[j] * (1 + C) and green and bars[j - 1]["c"] > vw[j - 1]: out.append((1, "vwap dip"))
    if "vwr" in S and b["h"] >= vw[j] * (1 - C) and c < vw[j] * (1 - C) and red and bars[j - 1]["c"] < vw[j - 1]: out.append((-1, "vwap rejection"))
    if "dfh" in S and ph > orh and b["h"] >= ph * (1 - C) and c < ph * (1 - 2 * C) and red: out.append((-1, "drop from high"))
    for side, name in out:
        if (side > 0 and c < vw[j]) or (side < 0 and c > vw[j]):
            continue                                   # trade with the day's direction (VWAP)
        if p["trend"] and name in ("breakout up", "breakdown") and side != P["trend"]:
            continue
        return side, name
    return None


def run(p, prep, dates, market):
    eur = EURUSD
    trades = []
    by_date = defaultdict(list)
    for (sym, d) in prep:
        by_date[d].append(sym)
    for d in dates:
        syms = sorted(by_date.get(d, []))
        if not syms:
            continue
        M = market.get(d)
        open_pos, pending, cool = {}, {}, defaultdict(int)
        day_pnl, n_today = 0.0, 0
        for j in range(3, 78):
            hm = SLOTS[j]
            # fills at this bar's open
            for sym, (side, name, a) in list(pending.items()):
                b = prep[(sym, d)]["bars"][j]
                px = b["o"] * (1 + SLIPPAGE * side)
                qty = STAKE_EUR * eur * p["lev"] / px
                open_pos[sym] = dict(s=side, e=px, q=qty, st=px - side * p["stop_atr"] * a, best=px,
                                     mv=False, be=(2 * FEE_PER_ORDER + p["trig"] * eur) / qty + 2 * SLIPPAGE * px,
                                     name=name, tin=hm)
                n_today += 1
            pending = {}
            # manage open trades
            for sym, pos in list(open_pos.items()):
                b = prep[(sym, d)]["bars"][j]; s = pos["s"]; ex = None
                if (s > 0 and b["l"] <= pos["st"]) or (s < 0 and b["h"] >= pos["st"]):
                    ex = min(b["o"], pos["st"]) if s > 0 else max(b["o"], pos["st"])
                    why = "trail" if pos["mv"] else "stop"
                elif hm >= 1555:
                    ex = b["c"]; why = "15:55"
                if ex is not None:
                    ex *= (1 - SLIPPAGE * s)
                    net = ((ex - pos["e"]) * pos["q"] * s - 2 * FEE_PER_ORDER) / eur
                    trades.append(dict(date=str(d), sym=sym, setup=pos["name"], side="long" if s > 0 else "short",
                                       t_in="%04d" % pos["tin"], t_out="%04d" % hm, entry=round(pos["e"], 2),
                                       exit=round(ex, 2), eur=round(net, 2), why=why))
                    day_pnl += net; del open_pos[sym]; cool[sym] = COOLDOWN_BARS
                    continue
                pos["best"] = max(pos["best"], b["h"]) if s > 0 else min(pos["best"], b["l"])
                if not pos["mv"] and (b["c"] - pos["e"]) * s >= pos["be"]:
                    pos["mv"] = True
                if pos["mv"]:
                    cand = pos["best"] - s * p["trail"] * eur / pos["q"]
                    pos["st"] = max(pos["st"], cand) if s > 0 else min(pos["st"], cand)
            # new signals on the bar that just closed
            if hm < p["start"] or hm >= 1530 or day_pnl <= -DAY_LOSS_STOP_EUR or n_today >= MAX_TRADES_PER_DAY:
                for sym in cool:
                    cool[sym] = max(0, cool[sym] - 1)
                continue
            for sym in syms:
                if cool[sym]:
                    cool[sym] -= 1; continue
                if sym in open_pos or len(open_pos) + len(pending) >= MAX_OPEN or n_today + len(pending) >= MAX_TRADES_PER_DAY:
                    continue
                P = prep[(sym, d)]
                sg = signal_for(P, j, p)
                if not sg:
                    continue
                if p["market"] and M is not None:
                    mc, mv = M["bars"][j]["c"], M["vw"][j]
                    if (sg[0] > 0 and mc < mv) or (sg[0] < 0 and mc > mv):
                        continue                       # market moving the other way
                pending[sym] = (sg[0], sg[1], P["atr"][j])
    return trades


def summary(trades, ndays):
    if not trades:
        return dict(trades=0, eur=0.0, per_day=0.0, win=0, avg_win=0, avg_loss=0, worst_day=0, green_days=0, red_days=0)
    w = [t["eur"] for t in trades if t["eur"] > 0]; l = [t["eur"] for t in trades if t["eur"] <= 0]
    days = defaultdict(float)
    for t in trades:
        days[t["date"]] += t["eur"]
    tot = sum(t["eur"] for t in trades)
    return dict(trades=len(trades), eur=round(tot, 2), per_day=round(tot / ndays, 2),
                win=round(100 * len(w) / len(trades)), avg_win=round(sum(w) / max(1, len(w)), 2),
                avg_loss=round(sum(l) / max(1, len(l)), 2), worst_day=round(min(days.values()), 2),
                green_days=sum(1 for v in days.values() if v > 0), red_days=sum(1 for v in days.values() if v < 0))


def fmt(p):
    return "lev x%d, start %d, trend %s, market %s, setups %s, move stop at fees+EUR%d, trail EUR%d, start stop %.1f ATR" % (
        p["lev"], p["start"], p["trend"], p["market"], "/".join(p["setups"]), p["trig"], p["trail"], p["stop_atr"])


# ----------------------------------------------------------------- main
def main():
    offline = "--offline" in sys.argv
    keys = None if offline else load_keys()
    all_days, feeds = {}, {}
    for sym in SYMBOLS + [MARKET]:
        if offline:
            path = os.path.join(DATA, sym + ".json")
            if not os.path.exists(path):
                continue
            payload = json.load(open(path))
        else:
            print("downloading", sym, "...", flush=True)
            payload = get_bars(sym, keys)
        feeds[sym] = payload["feed"]
        days = to_days(payload)
        if days:
            all_days[sym] = days
    if not all_days:
        sys.exit("No data.")
    dates = sorted(set(d for days in all_days.values() for d in days))
    market_days = all_days.pop(MARKET, {})
    prep = prepare(all_days, dates)
    mprep = {}
    if market_days:
        mp = prepare({MARKET: market_days}, dates)
        mprep = {d: v for (s, d), v in mp.items()}
    usable = sorted(set(d for (_, d) in prep))
    if len(usable) < 15:
        sys.exit("Too few days with data (%d)." % len(usable))
    cut = int(len(usable) * (1 - TEST_SHARE))
    train, test = usable[:cut], usable[cut:]

    lines = []
    def say(s=""):
        print(s); lines.append(s)

    say("Day-Trader backtest  (%s)" % dt.date.today())
    say("stocks: %d with data, market filter: %s, data feed: %s" % (len(all_days), MARKET if mprep else "none",
                                                                   ", ".join(sorted(set(feeds.values())))))
    say("TRAIN %s to %s (%d days)   TEST %s to %s (%d days)" % (train[0], train[-1], len(train), test[0], test[-1], len(test)))
    say("EUR %.0f per trade, fee USD %.2f per order, max %d open, max %d trades a day, day stop -EUR %.0f" % (
        STAKE_EUR, FEE_PER_ORDER, MAX_OPEN, MAX_TRADES_PER_DAY, DAY_LOSS_STOP_EUR))
    say()

    keys_ = list(GRID); combos = [dict(zip(keys_, c)) for c in itertools.product(*GRID.values())]
    print("tuning %d setting combinations on TRAIN days ..." % len(combos), flush=True)
    scored = []
    for i, p in enumerate(combos):
        tr = run(p, prep, train, mprep)
        scored.append((sum(t["eur"] for t in tr), len(tr), p))
        if (i + 1) % 20 == 0:
            print("  %d / %d" % (i + 1, len(combos)), flush=True)
    scored = [x for x in scored if x[1] >= 10]
    scored.sort(key=lambda x: -x[0])

    say("== Our default settings ==")
    say(fmt(DEFAULT))
    say("  TRAIN " + json.dumps(summary(run(DEFAULT, prep, train, mprep), len(train))))
    say("  TEST  " + json.dumps(summary(run(DEFAULT, prep, test, mprep), len(test))))
    say()
    say("== Top 5 settings on TRAIN, and how they did on unseen TEST days ==")
    best_test = None
    for tot, n, p in scored[:5]:
        te = run(p, prep, test, mprep)
        say(fmt(p))
        say("  TRAIN " + json.dumps(summary(run(p, prep, train, mprep), len(train))))
        say("  TEST  " + json.dumps(summary(te, len(test))))
        if best_test is None:
            best_test = te
    say()
    if best_test:
        by = defaultdict(list)
        for t in best_test:
            by[t["setup"]].append(t["eur"])
        say("== TEST results of the #1 setting, per setup ==")
        for k, v in sorted(by.items()):
            say("  %-16s trades %3d  EUR %8.2f  wins %d" % (k, len(v), sum(v), sum(1 for x in v if x > 0)))
        with open(os.path.join(HERE, "test_trades.csv"), "w", encoding="utf-8") as f:
            f.write("date,stock,setup,side,in,out,entry,exit,eur,exit_reason\n")
            for t in best_test:
                f.write("%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n" % (t["date"], t["sym"], t["setup"], t["side"], t["t_in"],
                                                            t["t_out"], t["entry"], t["exit"], t["eur"], t["why"]))
    with open(os.path.join(HERE, "results.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\nSaved results.txt and test_trades.csv. Send results.txt back.")


if __name__ == "__main__":
    main()
