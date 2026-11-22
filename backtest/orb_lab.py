#!/usr/bin/env python3
"""
ORB lab: the 5-minute Opening Range Breakout on Stocks in Play (Zarattini, Barbon & Aziz 2024)
plus the improvements traders and researchers suggest, tested honestly.

Universe: ~450 well-known US stocks (S&P 500 / Nasdaq-100 names and popular large caps).
Account: EUR 2,000. Fees: Interactive Brokers "Tiered" style (USD 0.0035 per share, min 0.35,
plus ~0.0003% regulatory on sells). Slippage: 0.02% per fill, and a stress test with 0.05%.

Variants tried (each month the bot only uses what worked in the 3 months before = walk-forward):
  top N in play: 3, 5, 10, 20          opening range: 5 or 15 minutes
  stop: 5/10/15/25% of daily ATR        direction: both / long only
  minimum relative volume: 1x, 2x, 3x   market filter: none / QQQ's first candle agrees
  exit: at the close / move stop to break-even after +1R
  sizing: fixed EUR 1,000 per trade, or RISK-BASED: lose at most EUR 10 / EUR 20 per trade
          with a leverage cap per trade of x4 or x10 of EUR 500 (= max EUR 2,000 / 5,000)

Usage: python orb_lab.py data   (download)      python orb_lab.py   (run)
Writes orb_results.txt
"""
import itertools
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import daytrader_backtest as base  # noqa: E402

EUR = base.EURUSD
SLOTS = base.SLOTS
IDX = base.SLOT_INDEX
ACCOUNT = 2000.0

UNIVERSE = sorted(set("""
AAPL MSFT NVDA AMZN META GOOGL GOOG TSLA AVGO AMD NFLX ORCL CRM ADBE INTC QCOM TXN MU AMAT LRCX KLAC MRVL ARM SMCI DELL HPQ
IBM CSCO ANET PANW CRWD ZS NET DDOG SNOW MDB PLTR SHOP UBER LYFT ABNB DASH BKNG EXPE MAR HLT RCL CCL NCLH DAL UAL AAL LUV
BA GE CAT DE HON MMM RTX LMT NOC GD UPS FDX JPM BAC WFC C GS MS SCHW AXP V MA PYPL COIN HOOD SOFI AFRM MSTR RIOT MARA XOM
CVX COP OXY SLB HAL DVN EOG MPC VLO PSX LLY UNH JNJ PFE MRK ABBV AMGN GILD BMY REGN VRTX MRNA BIIB ISRG TMO DHR ABT MDT
CVS CI HUM WMT COST TGT HD LOW NKE SBUX MCD CMG LULU DIS CMCSA T VZ TMUS KO PEP PG RBLX U SPOT PINS SNAP TTD ROKU ZM DOCU
TWLO OKTA SE MELI BABA PDD JD NIO RIVN LCID F GM TSM ASML
ACN ADI ADP ADSK AEP AIG ALL AMT AON APD APH AZO BDX BK BLK BSX BX CB CCI CDNS CEG CHTR CL CME CMI COF CPRT CSX CTAS CTSH
D DHI DLR DUK DXCM EA EBAY ECL ED EL EMR ENPH EQIX ETN EW EXC FANG FAST FCX FI FICO FTNT GIS GLW GPN HCA HES HSY ICE IDXX
ILMN INTU IQV IT ITW KDP KHC KMB KMI KR LEN LHX LIN LVS MCHP MCK MCO MDLZ MET MNST MO MPWR MSCI MSI NDAQ NEE NEM NOW NSC
NUE NXPI ODFL ON ORLY OTIS PANW PAYX PCAR PEG PGR PH PLD PM PNC PPG PSA PYPL QRVO RF RMD ROK ROP ROST RSG SBAC SHW SNPS SO
SPG SRE STZ SYK SYY TDG TEAM TEL TFC TJX TRV TSCO TT TTWO TXN TYL ULTA UNP URI USB VLO VMC VRSK WBA WBD WDAY WDC WELL WM
WMB XEL XYL YUM ZBH ZTS ALB APA BBY BG BKR CAH CARR CF CHRW CNC CTRA DD DG DLTR DOV DPZ DRI EFX EIX ETR EXPD FDS FITB FSLR
GEHC GEN GPC HAS HBAN HIG HPE HRL HST HWM IFF INCY IP IR JBHT JCI K KEY KEYS KVUE LDOS LKQ LUMN LYB MAS MGM MKC MLM MOH MOS
MRO MTB NDSN NI NRG NTAP NTRS NVR NWSA OKE OMC PARA PFG PHM PKG PNR POOL PPL PRU PTC PWR RJF RL RVTY SJM SLG SNA STE STLD
STT STX SWK SWKS SYF TAP TECH TER TPR TRGP TRMB TSN UAL UHS ULTA VTR VTRS WAB WAT WEC WRB WST WY WYNN ZBRA
APP CVNA DKNG CELH ELF DUOL IOT PATH S AI UPST CHWY ETSY W GME AMC SPOT TOST NU GRAB CAVA ONON DECK CROX ANF SMCI VRT
""".split()))

STAKE_LIST_NOTE = "Each trade's size is shown in the table; the account is EUR %.0f." % ACCOUNT


# ------------------------------------------------------------------ data
def download():
    from concurrent.futures import ThreadPoolExecutor
    keys = base.load_keys()

    def one(sym):
        try:
            n = len(base.get_bars(sym, keys)["bars"])
            print("data %-5s %6d bars" % (sym, n), flush=True)
        except Exception as e:
            print("data %-5s FAILED: %s" % (sym, e), flush=True)
    with ThreadPoolExecutor(max_workers=3) as ex:
        list(ex.map(one, UNIVERSE + [base.MARKET]))


def load():
    raw = {}
    for sym in UNIVERSE + [base.MARKET]:
        p = os.path.join(base.DATA, sym + ".json")
        if os.path.exists(p):
            dd = base.to_days(json.load(open(p)))
            if len(dd) > 30:
                raw[sym] = dd
    return raw


# ------------------------------------------------------------------ one trade
def simulate_trade(b, j0, side, lvl, stop_dist, be, slip):
    for j in range(j0, 78):
        if (side > 0 and b[j]["h"] >= lvl) or (side < 0 and b[j]["l"] <= lvl):
            fill = (max(lvl, b[j]["o"]) if side > 0 else min(lvl, b[j]["o"])) * (1 + slip * side)
            stop = fill - side * stop_dist; moved = False
            for k in range(j, 78):
                x = b[k]
                if k == j:                     # entry bar: we only know its close
                    x = dict(o=x["c"], h=x["c"], l=x["c"], c=x["c"])
                if (side > 0 and x["l"] <= stop) or (side < 0 and x["h"] >= stop):
                    ex = min(x["o"], stop) if side > 0 else max(x["o"], stop)
                    return fill, ex * (1 - slip * side)
                if be and not moved and (x["c"] - fill) * side >= stop_dist:
                    stop = fill; moved = True
            return fill, b[77]["c"] * (1 - slip * side)
    return None


def fee_usd(notional_usd, price):
    sh = max(1.0, notional_usd / price)
    return max(0.35, 0.0035 * sh)


# ------------------------------------------------------------------ build all candidate trades once
def build(raw, slip):
    """For every stock-day: context + the trade result under each (range, stop, exit) option."""
    m = raw.get(base.MARKET, {})
    rows = defaultdict(list)                   # day -> list of candidate dicts
    for sym, dd in raw.items():
        if sym == base.MARKET:
            continue
        ds = sorted(dd); daily = []
        for d in ds:
            b = dd[d]
            daily.append(dict(h=max(x["h"] for x in b), l=min(x["l"] for x in b), c=b[-1]["c"],
                              v=sum(x["v"] for x in b), v5=b[0]["v"], v15=sum(x["v"] for x in b[:3])))
        for k, d in enumerate(ds):
            if k < 15:
                continue
            past = daily[k - 14:k]
            atr = sum(max(x["h"] - x["l"], abs(x["h"] - y["c"]), abs(x["l"] - y["c"]))
                      for y, x in zip(daily[k - 15:k - 1], past)) / 14
            avgvol = sum(x["v"] for x in past) / 14
            b = dd[d]
            if b[0]["o"] < 5 or avgvol < 1e6 or atr < 0.5:
                continue
            for rng in (5, 15):
                n = rng // 5
                o, c = b[0]["o"], b[n - 1]["c"]
                side = 1 if c > o else (-1 if c < o else 0)
                if not side:
                    continue
                av = sum(x["v5" if rng == 5 else "v15"] for x in past) / 14
                if av <= 0:
                    continue
                rv = (b[0]["v"] if rng == 5 else sum(x["v"] for x in b[:3])) / av
                if rv < 1:
                    continue
                hi = max(x["h"] for x in b[:n]); lo = min(x["l"] for x in b[:n])
                mk = 0
                if d in m:
                    mo, mc = m[d][0]["o"], m[d][n - 1]["c"]
                    mk = 1 if mc > mo else (-1 if mc < mo else 0)
                res = {}
                for sp in (0.05, 0.10, 0.15, 0.25):
                    for be in (0, 1):
                        t = simulate_trade(b, n, side, hi if side > 0 else lo, sp * atr, be, slip)
                        if t:
                            res[(sp, be)] = (t[0], t[1])
                if res:
                    rows[(d, rng)].append(dict(sym=sym, rng=rng, side=side, rv=rv, mk=mk, atr=atr, px=b[0]["o"], res=res))
    for k in rows:
        rows[k].sort(key=lambda r: -r["rv"])
    return rows


def run_variant(rows, days, v):
    """-> per-day EUR P&L for one variant."""
    out = {}
    for d in days:
        pnl = 0.0; taken = 0
        for r in rows.get((d, v["rng"]), []):          # already sorted by relative volume
            if r["rv"] < v["minrv"]:
                break
            if (v["dir"] == "long" and r["side"] < 0) or (v["mkt"] and r["mk"] != r["side"]):
                continue
            taken += 1
            if taken > v["top"]:
                break
            t = r["res"].get((v["stop"], v["be"]))
            if not t:
                continue
            fill, ex = t; side = r["side"]
            stop_pct = v["stop"] * r["atr"] / fill
            if v["size"] == "fixed":
                notional = 1000.0
            else:
                risk, cap = v["size"]
                notional = min(risk / stop_pct, cap)
            ret = (ex - fill) / fill * side
            fee = 2 * fee_usd(notional * EUR, fill) / EUR + 0.000003 * notional
            pnl += notional * ret - fee
        out[d] = pnl
    return out


def stats(daily):
    vals = list(daily.values())
    eq = peak = dd = 0.0
    for x in vals:
        eq += x; peak = max(peak, eq); dd = min(dd, eq - peak)
    return sum(vals), sum(vals) / max(1, len(vals)), dd, min(vals) if vals else 0.0


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "data":
        download(); return
    raw = load()
    days = sorted(set(d for s, v in raw.items() if s != base.MARKET for d in v))
    days = days[15:]
    lines = []

    def say(s=""):
        print(s, flush=True); lines.append(s)

    grid = dict(top=[3, 5, 10, 20], rng=[5, 15], stop=[0.05, 0.10, 0.15, 0.25], dir=["both", "long"],
                minrv=[1, 2, 3], mkt=[0, 1], be=[0, 1],
                size=["fixed", (10, 2000), (10, 5000), (20, 2000), (20, 5000)])
    keys = list(grid); variants = [dict(zip(keys, c)) for c in itertools.product(*grid.values())]
    paper = dict(top=20, rng=5, stop=0.10, dir="both", minrv=1, mkt=0, be=0, size="fixed")
    paper5 = dict(paper, top=5)

    for slip in (0.0002, 0.0005):
        rows = build(raw, slip)
        say("=" * 100)
        say("ORB lab: %d stocks, %s..%s (%d days), account EUR %.0f, IBKR tiered fees, slippage %.2f%% per fill" % (
            len(raw) - 1, days[0], days[-1], len(days), ACCOUNT, slip * 100))
        say("sizing: 'fixed' = EUR 1,000 per trade; (10, 2000) = lose at most EUR 10 per trade, position max EUR 2,000")
        say("")
        say("%-60s %9s %8s %9s %9s" % ("variant", "EUR/day", "total", "max DD", "worst day"))
        for name, v in (("paper rules, top 20, EUR 1,000/trade", paper), ("paper rules, top 5, EUR 1,000/trade", paper5)):
            t, pd, dd, w = stats(run_variant(rows, days, v))
            say("%-60s %+9.2f %+8.0f %+9.0f %+9.0f" % (name, pd, t, dd, w))
        for risk, cap in ((10, 2000), (10, 5000), (20, 5000)):
            v = dict(paper5, size=(risk, cap))
            t, pd, dd, w = stats(run_variant(rows, days, v))
            say("%-60s %+9.2f %+8.0f %+9.0f %+9.0f" % ("paper rules, top 5, risk EUR %d/trade, max EUR %d" % (risk, cap), pd, t, dd, w))
        say("")
        # walk-forward over all variants
        months = sorted(set("%d-%02d" % (d.year, d.month) for d in days))
        mdays = defaultdict(list)
        for d in days:
            mdays["%d-%02d" % (d.year, d.month)].append(d)
        res = {}
        for i, v in enumerate(variants):
            res[i] = run_variant(rows, days, v)
        say("Walk-forward over %d variants (each month: the variant that earned most in the 3 months before):" % len(variants))
        wf = {}
        for mi in range(3, len(months)):
            win = [d for mo in months[mi - 3:mi] for d in mdays[mo]]
            best = max(res, key=lambda i: sum(res[i][d] for d in win))
            tot = sum(res[best][d] for d in mdays[months[mi]])
            for d in mdays[months[mi]]:
                wf[d] = res[best][d]
            say("  %s  EUR %+8.2f  (%+.2f/day)  %s" % (months[mi], tot, tot / len(mdays[months[mi]]), json.dumps(variants[best])))
        t, pd, dd, w = stats(wf)
        say("  WALK-FORWARD TOTAL EUR %+.0f = EUR %+.2f per day, max drawdown EUR %.0f, worst day EUR %.0f" % (t, pd, dd, w))
        say("")
        ranked = sorted(res, key=lambda i: -sum(res[i].values()))
        say("Best 8 variants over the whole year (hindsight, for understanding only):")
        for i in ranked[:8]:
            t, pd, dd, w = stats(res[i])
            say("  EUR/day %+7.2f  maxDD %+6.0f  worst day %+5.0f  %s" % (pd, dd, w, json.dumps(variants[i])))
        say("")
        # what each single change does (average over all variants that have it)
        say("Effect of each choice (average EUR/day over all variants with it):")
        for k in keys:
            parts = []
            for val in grid[k]:
                ids = [i for i, v in enumerate(variants) if v[k] == val]
                parts.append("%s: %+.2f" % (val, sum(sum(res[i].values()) for i in ids) / len(ids) / len(days)))
            say("  %-6s %s" % (k, "   ".join(parts)))
        say("")
    with open(os.path.join(base.HERE, "orb_results.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
