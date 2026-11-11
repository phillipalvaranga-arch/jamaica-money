#!/usr/bin/env python3
"""Fetch public Jamaican market data into data/*.json.

Runs in GitHub Actions on a schedule. Uses only the Python standard library.
Every value comes from a public page. If a page cannot be read, the last good
values in the JSON file are kept and marked with the date they were read.
"""
import html, json, os, re, sys, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
UA = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')
NOW = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
LOG = []


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml'})
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.read().decode('utf-8', 'ignore')


def text(s):
    s = re.sub(r'<script.*?</script>|<style.*?</style>|<noscript.*?</noscript>', ' ', s, flags=re.S | re.I)
    s = html.unescape(re.sub(r'<[^>]+>', ' ', s))
    return re.sub(r'\s+', ' ', s).strip()


def num(s):
    s = (s or '').replace(',', '').replace('$', '').strip()
    try:
        return float(s)
    except ValueError:
        return None


def load(name):
    try:
        with open(os.path.join(DATA, name)) as f:
            return json.load(f)
    except Exception:
        return None


def save(name, obj):
    with open(os.path.join(DATA, name), 'w') as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)
        f.write('\n')


# ---------------------------------------------------------------- JSE
JSE = 'https://www.jamstockex.com'
SECTIONS = ['INDICES', 'ORDINARY SHARES', 'US DENOMINATED SHARES', 'PREFERENCE SHARES']


def split_sections(page):
    """Return list of (section, table_html) in page order."""
    marks = []
    for sec in SECTIONS:
        for m in re.finditer(r'>\s*' + re.escape(sec) + r'\s*<', page):
            marks.append((m.start(), sec))
    marks.sort()
    out = []
    for m in re.finditer(r'<table.*?</table>', page, flags=re.S):
        sec = None
        for pos, s in marks:
            if pos < m.start():
                sec = s
        out.append((sec, m.group(0)))
    return out


def rows(table):
    for tr in re.findall(r'<tr.*?</tr>', table, flags=re.S):
        tds = re.findall(r'<td[^>]*>(.*?)</td>', tr, flags=re.S)
        if tds:
            yield tr, tds


def fetch_jse():
    home = get(JSE + '/')
    m = re.search(r'Market\s+(Open|Closed)\s*</?[^>]*>?\s*(\d{4}-\d{2}-\d{2})', home) or \
        re.search(r'Market (Open|Closed)\s+(\d{4}-\d{2}-\d{2})', text(home))
    if not m:
        raise RuntimeError('JSE trade date not found')
    status, date = m.group(1), m.group(2)
    indices, stocks = [], {}
    combined = get(f'{JSE}/trading/trade-quotes/?market=50&date={date}')
    seen = set()
    for sec, tbl in split_sections(combined):
        if sec != 'INDICES':
            continue
        for tr, tds in rows(tbl):
            name = text(tds[0])
            if not name or name in seen or len(tds) < 5:
                continue
            seen.add(name)
            code = re.search(r'indexCode=(\d+)', tds[0])
            indices.append({'name': name, 'value': num(text(tds[1])), 'volume': num(text(tds[2])),
                            'change': num(text(tds[3])), 'pct': num(text(tds[4])),
                            'code': code.group(1) if code else None})
    for mcode, mname in (('31', 'Main'), ('22', 'Junior'), ('49', 'USD')):
        page = combined if mcode == '50' else get(f'{JSE}/trading/trade-quotes/?market={mcode}&date={date}')
        for sec, tbl in split_sections(page):
            if sec in (None, 'INDICES'):
                continue
            for tr, tds in rows(tbl):
                if len(tds) < 10:
                    continue
                a = re.search(r'title="([^"]*)"', tds[1])
                inst = re.search(r'instrument=(\d+)', tds[1])
                sym = text(tds[1])
                if not sym or sym in stocks:
                    continue
                close, chg = num(text(tds[3])), num(text(tds[4]))
                prev = (close - chg) if (close is not None and chg is not None) else None
                pct = round(chg / prev * 100, 2) if prev else None
                rng = [num(x) for x in text(tds[9]).split(' - ')] if ' - ' in text(tds[9]) else [None, None]
                stocks[sym] = {
                    'sym': sym, 'name': html.unescape(a.group(1)).strip() if a else sym,
                    'market': mname, 'type': {'ORDINARY SHARES': 'Ordinary', 'US DENOMINATED SHARES': 'US$ shares',
                                              'PREFERENCE SHARES': 'Preference'}.get(sec, sec),
                    'cur': 'USD' if (mname == 'USD' or sec == 'US DENOMINATED SHARES') else 'JMD',
                    'last': num(text(tds[2])), 'close': close, 'chg': chg, 'pct': pct,
                    'bid': num(text(tds[5])), 'ask': num(text(tds[6])), 'vol': num(text(tds[7])),
                    'lo52': rng[0], 'hi52': rng[1] if len(rng) > 1 else None,
                    'suspended': '(SUS)' in sym,
                    'id': inst.group(1) if inst else None,
                }
    if len(stocks) < 20:
        raise RuntimeError(f'Only {len(stocks)} JSE rows parsed')
    save('jse.json', {'source': JSE + '/trading/trade-quotes/', 'tradeDate': date, 'marketStatus': status,
                      'fetched': NOW, 'indices': indices, 'stocks': sorted(stocks.values(), key=lambda s: s['sym'])})
    LOG.append(f'JSE ok {date}: {len(indices)} indices, {len(stocks)} stocks')


# ---------------------------------------------------------------- BOJ
BOJ = 'https://boj.org.jm/'
MONTHS = 'January February March April May June July August September October November December'.split()


def fetch_boj():
    old = load('boj.json') or {}
    s = text(get(BOJ))
    out = dict(old)
    m = re.search(r'POLICY INTEREST RATE\s+([\d.]+)%\s+(\d{1,2} \w+ \d{4})\s*\|\s*Next:\s*(\d{1,2} \w+ \d{4})', s)
    if m:
        out['policy'] = {'rate': float(m.group(1)), 'since': m.group(2), 'next': m.group(3),
                         'source': 'https://boj.org.jm/core-functions/monetary-policy/policy-schedule/summary-of-decisions/', 'read': NOW}
    m = re.search(r'INFLATION RATE\s+([\d.]+)%\s+(\w+ \d{4})', s)
    if m:
        out['inflation'] = {'rate': float(m.group(1)), 'month': m.group(2), 'read': NOW,
                            'source': BOJ}
    m = re.search(r'INFLATION TARGET\s+([\d.]+)\s*[–-]\s*([\d.]+)\s*%', s)
    if m:
        out['target'] = [float(m.group(1)), float(m.group(2))]
    m = re.search(r'Foreign Exchange Rates\s+(\d{1,2} \w{3} \d{2})\s+BUY SELL\s+(.*?)(?:RSS|Learn)', s)
    if m:
        fx = {}
        for c, b, se in re.findall(r'([A-Z]{3})\s+([\d.]+)\s+([\d.]+)', m.group(2)):
            fx[c] = {'buy': float(b), 'sell': float(se)}
        if 'USD' in fx:
            out['fx'] = {'date': m.group(1), 'rates': fx, 'read': NOW,
                         'note': 'Bank of Jamaica weighted average buy and sell rates for the day, as shown on the BOJ home page.',
                         'source': 'https://boj.org.jm/', 'more': 'https://boj.org.jm/market/foreign-exchange/daily-fx-spot-trading-summary/'}
    m = re.search(r'FIXED RATE CERTIFICATE OF DEPOSIT:\s*([\d.]+)%', s)
    m2 = re.search(r'30-day CD Auction Term Sheet\s*[–-]\s*(\d{1,2} \w+ \d{4})', s)
    if m:
        out['cd30'] = {'rate': float(m.group(1)), 'date': m2.group(1) if m2 else None, 'read': NOW,
                       'source': 'https://boj.org.jm/category/notices/money-market/'}
    out['fetched'] = NOW
    save('boj.json', out)
    LOG.append('BOJ ok: ' + ', '.join(k for k in ('policy', 'inflation', 'fx', 'cd30') if k in out))


# ---------------------------------------------------------------- Provider rates
def upd(rates, rid, **kw):
    for r in rates:
        if r['id'] == rid:
            r.update(kw)
            r['read'] = NOW
            r['auto'] = True
            return
    LOG.append('rate id missing: ' + rid)


def fetch_proven(rates):
    s = text(get('https://www.provenwealth.com/rates/'))
    d = re.search(r'Unit Trust rates were last updated on (\w+ \d{1,2})\s*,\s*(\d{4})', s)
    asof = f'{d.group(1)}, {d.group(2)}' if d else None
    for rid, label in (('proven-mm-jmd', 'PROVEN SELECT MONEY MARKET JMD'), ('proven-mm-usd', 'PROVEN SELECT MONEY MARKET USD')):
        m = re.search(re.escape(label) + r'\s+F\s+[\d.]+\s+([-\d.]+)%\s+([-\d.]+)%\s+([-\d.]+)%', s)
        if m:
            upd(rates, rid, value=float(m.group(3)), g12=float(m.group(1)), ytd=float(m.group(2)), asOf=asof)


def fetch_scotia(rates):
    s = text(get('https://jm.scotiabank.com/scotia-investments/fund-prices.html'))
    d = re.search(r'JMD Denominated Scotia Funds\s+(\w+ \d{1,2}, \d{4})', s)
    m = re.search(r'Scotia Premium Money Market Fund\s+[\d.]+\s+([-\d.]+)%\s+([-\d.]+)%\s+([-\d.]+)%', s)
    if m:
        upd(rates, 'scotia-mm-jmd', value=float(m.group(3)), ytd=float(m.group(1)), g12=float(m.group(2)),
            asOf=d.group(1) if d else None)
    d = re.search(r'USD denominated Scotia Funds\s+as at\s+(\w+ \d{1,2}, \d{4})', s)
    m = re.search(r'Scotia Money Market Fund\s+A\s+[\d.]+\s+[-\d.]+\s+([-\d.]+)%\s+([-\d.]+)%', s)
    if m:
        upd(rates, 'scotia-mm-usd', g12=float(m.group(2)), ytd=float(m.group(1)), asOf=d.group(1) if d else None)


def fetch_gk(rates):
    s = text(get('https://gk-capital.com/gk-mutual-funds/'))
    d = re.search(r'respective Funds as at (\w+ \d{1,2}, \d{4})', s)
    m = re.search(r'GK Jamaican Dollar Money Market Fund \(Low[^)]*\)\s+[\d.]+\s+[\d.]+\s+([-\d.]+)%\s+([-\d.]+)%\s+([-\d.]+)%', s)
    if m:
        upd(rates, 'gk-mm-jmd', ytd=float(m.group(2)), g12=float(m.group(3)), asOf=d.group(1) if d else None)


def fetch_barita(rates):
    s = text(get('https://www.barita.com/rates/'))
    d = re.search(r'Prices as at \w+, (\w+ \d{1,2}, \d{4})', s)
    m = re.search(r'Money Market\s+F\s+[\d.]+\s+([-\d.]+)%\s+([-\d.]+)%\s+([-\d.]+)%', s)
    if m:
        upd(rates, 'barita-mm-jmd', value=float(m.group(3)), g12=float(m.group(1)), ytd=float(m.group(2)),
            asOf=d.group(1) if d else None)


def fetch_jmmb(rates):
    s = text(get('https://jm.jmmb.com/rates-fees'))
    m = re.search(r'Money market rates\s+Last updated:\s*(\d{4})/(\d{2})/(\d{2})\s+Code Rate\s+Tax Shelter Rate\(JA\)\s+([\d.]+)%', s)
    if m:
        y, mo, da = int(m.group(1)), int(m.group(2)), int(m.group(3))
        upd(rates, 'jmmb-taxshelter', value=float(m.group(4)), asOf=f'{MONTHS[mo-1]} {da}, {y}')


def fetch_sagicor(rates):
    s = text(get('https://www.sagicor.com/en-jm/personal-solution/investment/sigma-global-funds'))
    d = re.search(r'Subscription Price as at (\d{2})/(\d{2})/(\d{4})', s)
    m = re.search(r'Sigma Income\s+\$[\d.]+\s+\$[\d.]+\s+([-\d.]+)\s*%\s+([-\d.]+)\s*%\s+([-\d.]+)\s*%', s)
    if m and d:
        upd(rates, 'sagicor-income-jmd', value=None, listedYield=float(m.group(1)), label=f'Yield listed as {float(m.group(1)):.2f}%', ytd=float(m.group(2)), g12=float(m.group(3)),
            asOf=f'{MONTHS[int(d.group(1))-1]} {int(d.group(2))}, {d.group(3)}')


def fetch_rates():
    doc = load('rates.json')
    if not doc:
        LOG.append('rates.json missing; skipped')
        return
    for fn in (fetch_proven, fetch_scotia, fetch_gk, fetch_barita, fetch_jmmb, fetch_sagicor):
        try:
            fn(doc['rates'])
            LOG.append(fn.__name__ + ' ok')
        except Exception as e:  # keep last good values
            LOG.append(f'{fn.__name__} failed: {e}')
    doc['fetched'] = NOW
    save('rates.json', doc)


if __name__ == '__main__':
    os.makedirs(DATA, exist_ok=True)
    for fn in (fetch_jse, fetch_boj, fetch_rates):
        try:
            fn()
        except Exception as e:
            LOG.append(f'{fn.__name__} failed: {e}')
    print('\n'.join(LOG))
