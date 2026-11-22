#!/usr/bin/env python3
"""Download 5-minute bars (regular hours only) for a fixed past period into data_hist/.
Usage: python hist_data.py 2023-01-01 2025-11-30"""
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import daytrader_backtest as base  # noqa: E402
import search10k as eng  # noqa: E402

OUT = os.path.join(base.HERE, "data_hist")


def fetch(sym, keys, start, end):
    bars, token = [], None
    while True:
        q = dict(symbols=sym, timeframe="5Min", start=start + "T00:00:00Z", end=end + "T23:59:59Z",
                 adjustment="all", feed="sip", limit=10000)
        if token:
            q["page_token"] = token
        req = urllib.request.Request(base.BASE + "?" + urllib.parse.urlencode(q),
                                     headers={"APCA-API-KEY-ID": keys[0], "APCA-API-SECRET-KEY": keys[1]})
        for attempt in range(6):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = json.load(r)
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    time.sleep(5 * (attempt + 1)); continue
                raise
        for b in data.get("bars", {}).get(sym, []):
            ny = base.to_ny(dt.datetime.strptime(b["t"][:19], "%Y-%m-%dT%H:%M:%S"))
            if 930 <= ny.hour * 100 + ny.minute <= 1555:
                bars.append([b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]])
        token = data.get("next_page_token")
        time.sleep(0.3)
        if not token:
            return bars


def main():
    start, end = sys.argv[1], sys.argv[2]
    keys = base.load_keys()
    os.makedirs(OUT, exist_ok=True)

    def one(sym):
        try:
            bars = fetch(sym, keys, start, end)
            json.dump(dict(feed="sip", bars=bars), open(os.path.join(OUT, sym + ".json"), "w"))
            print("hist %-5s %7d bars" % (sym, len(bars)), flush=True)
        except Exception as e:
            print("hist %-5s FAILED %s" % (sym, e), flush=True)
    with ThreadPoolExecutor(max_workers=3) as ex:
        list(ex.map(one, eng.UNIVERSE + [base.MARKET]))


if __name__ == "__main__":
    main()
