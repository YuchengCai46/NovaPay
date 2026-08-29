"""
NovaPay V6.0 — 外汇汇率服务（模拟外汇，接免费公开汇率 API）

数据源：fawazahmed0/exchange-api（GitHub，经 jsDelivr CDN 分发，免费、无需密钥、含历史）
  - 实时：https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/{base}.json
  - 历史：https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{YYYY-MM-DD}/v1/currencies/{base}.json
返回结构：{"date": "2026-08-16", "{base}": {"usd": 1.0, "eur": 0.92, ...}}

说明：
  - 该 API 同时包含加密货币（ada/aave/1inch...），此处用 FIAT 白名单过滤，仅暴露法币。
  - 汇率只读、仅用于模拟换算，不涉及任何真实资金流动。
"""
import time
import json
import threading
from concurrent.futures import ThreadPoolExecutor

try:
    import urllib.request
except Exception:  # pragma: no cover
    urllib = None

LATEST_URL = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/{base}.json"
HIST_URL = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{date}/v1/currencies/{base}.json"

# 法币白名单（ISO 4217 常用集合，排除加密货币）。code -> 英文名称。
FIAT = {
    "aed": "UAE Dirham", "afn": "Afghan Afghani", "all": "Albanian Lek", "amd": "Armenian Dram",
    "ang": "Netherlands Antillean Guilder", "aoa": "Angolan Kwanza", "ars": "Argentine Peso",
    "aud": "Australian Dollar", "awg": "Aruban Florin", "azn": "Azerbaijani Manat",
    "bam": "Bosnia-Herzegovina Mark", "bdt": "Bangladeshi Taka", "bgn": "Bulgarian Lev",
    "bhd": "Bahraini Dinar", "bif": "Burundian Franc", "bmd": "Bermudan Dollar",
    "bnd": "Brunei Dollar", "bob": "Bolivian Boliviano", "brl": "Brazilian Real",
    "bsd": "Bahamian Dollar", "btc": "Bitcoin", "bwp": "Botswanan Pula", "byn": "Belarusian Ruble",
    "bzd": "Belize Dollar", "cad": "Canadian Dollar", "cdf": "Congolese Franc",
    "chf": "Swiss Franc", "clp": "Chilean Peso", "cny": "Chinese Yuan", "cop": "Colombian Peso",
    "crc": "Costa Rican Colón", "cup": "Cuban Peso", "cve": "Cape Verdean Escudo",
    "czk": "Czech Koruna", "djf": "Djiboutian Franc", "dkk": "Danish Krone",
    "dop": "Dominican Peso", "dzd": "Algerian Dinar", "egp": "Egyptian Pound",
    "ern": "Eritrean Nakfa", "etb": "Ethiopian Birr", "eur": "Euro", "fjd": "Fijian Dollar",
    "gbp": "British Pound", "gel": "Georgian Lari", "ghs": "Ghanaian Cedi", "gmd": "Gambian Dalasi",
    "gnf": "Guinean Franc", "gtq": "Guatemalan Quetzal", "hkd": "Hong Kong Dollar",
    "hnl": "Honduran Lempira", "hrk": "Croatian Kuna", "htg": "Haitian Gourde",
    "huf": "Hungarian Forint", "idr": "Indonesian Rupiah", "ils": "Israeli New Shekel",
    "inr": "Indian Rupee", "iqd": "Iraqi Dinar", "irr": "Iranian Rial", "isk": "Icelandic Króna",
    "jmd": "Jamaican Dollar", "jod": "Jordanian Dinar", "jpy": "Japanese Yen",
    "kes": "Kenyan Shilling", "kgs": "Kyrgystani Som", "khr": "Cambodian Riel",
    "kmf": "Comorian Franc", "krw": "South Korean Won", "kwd": "Kuwaiti Dinar",
    "kyd": "Cayman Islands Dollar", "kzt": "Kazakhstani Tenge", "lak": "Laotian Kip",
    "lbp": "Lebanese Pound", "lkr": "Sri Lankan Rupee", "lyd": "Libyan Dinar",
    "mad": "Moroccan Dirham", "mdl": "Moldovan Leu", "mga": "Malagasy Ariary",
    "mkd": "Macedonian Denar", "mmk": "Myanma Kyat", "mnt": "Mongolian Tugrik",
    "mop": "Macanese Pataca", "mur": "Mauritian Rupee", "mvr": "Maldivian Rufiyaa",
    "mwk": "Malawian Kwacha", "mxn": "Mexican Peso", "myr": "Malaysian Ringgit",
    "mzn": "Mozambican Metical", "nad": "Namibian Dollar", "ngn": "Nigerian Naira",
    "nio": "Nicaraguan Córdoba", "nok": "Norwegian Krone", "npr": "Nepalese Rupee",
    "nzd": "New Zealand Dollar", "omr": "Omani Rial", "pab": "Panamanian Balboa",
    "pen": "Peruvian Sol", "pgk": "Papua New Guinean Kina", "php": "Philippine Peso",
    "pkr": "Pakistani Rupee", "pln": "Polish Złoty", "pyg": "Paraguayan Guarani",
    "qar": "Qatari Rial", "ron": "Romanian Leu", "rsd": "Serbian Dinar",
    "rub": "Russian Ruble", "rwf": "Rwandan Franc", "sar": "Saudi Riyal",
    "sbd": "Solomon Islands Dollar", "scr": "Seychellois Rupee", "sdg": "Sudanese Pound",
    "sek": "Swedish Krona", "sgd": "Singapore Dollar", "shp": "Saint Helena Pound",
    "sll": "Sierra Leonean Leone", "sos": "Somali Shilling", "srd": "Surinamese Dollar",
    "ssp": "South Sudanese Pound", "std": "São Tomé and Príncipe Dobra",
    "svc": "Salvadoran Colón", "szl": "Swazi Lilangeni", "thb": "Thai Baht",
    "tjs": "Tajikistani Somoni", "tmt": "Turkmenistani Manat", "tnd": "Tunisian Dinar",
    "top": "Tongan Paʻanga", "try": "Turkish Lira", "ttd": "Trinidad and Tobago Dollar",
    "twd": "New Taiwan Dollar", "tzs": "Tanzanian Shilling", "uah": "Ukrainian Hryvnia",
    "ugx": "Ugandan Shilling", "usd": "US Dollar", "uyu": "Uruguayan Peso",
    "uzs": "Uzbekistan Som", "vef": "Venezuelan Bolívar", "vnd": "Vietnamese Dong",
    "vuv": "Vanuatu Vatu", "wst": "Samoan Tala", "xaf": "CFA Franc BEAC",
    "xcd": "East Caribbean Dollar", "xof": "CFA Franc BCEAO", "xpf": "CFP Franc",
    "yer": "Yemeni Rial", "zar": "South African Rand", "zmw": "Zambian Kwacha",
    "zwl": "Zimbabwean Dollar",
}

# 别名：部分 API 用小写，统一以小写 code 为键
_FIAT_KEYS = set(FIAT.keys())

_CACHE = {}          # key -> (expire_ts, payload)
_CACHE_LOCK = threading.Lock()
_RATE_TTL = 600      # 实时汇率缓存 10 分钟
_HIST_TTL = 86400 * 7  # 历史某日汇率缓存 7 天（历史不可变）


def _fetch_json(url):
    if urllib is None:
        raise RuntimeError("urllib 不可用 / urllib unavailable")
    req = urllib.request.Request(url, headers={"User-Agent": "NovaPay/6.0"})
    with urllib.request.urlopen(req, timeout=8) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _cache_get(key):
    with _CACHE_LOCK:
        item = _CACHE.get(key)
        if item and item[0] > time.time():
            return item[1]
    return None


def _cache_put(key, payload, ttl):
    with _CACHE_LOCK:
        _CACHE[key] = (time.time() + ttl, payload)


def get_rates(base):
    """返回 {code: rate}，rate 表示 1 单位 base 可兑换多少 code（仅法币）。"""
    base = (base or "usd").lower()
    key = f"rates:{base}"
    cached = _cache_get(key)
    if cached is not None:
        return cached
    url = LATEST_URL.format(base=base)
    data = _fetch_json(url)
    base_rates = data.get(base, {})
    out = {}
    for code, rate in base_rates.items():
        c = code.lower()
        if c in _FIAT_KEYS:
            out[c] = float(rate)
    _cache_put(key, out, _RATE_TTL)
    return out


def get_history(from_c, to_c, days=30):
    """返回 [{date, rate}]，rate 表示 1 单位 from_c 可兑换多少 to_c（真实历史）。"""
    from_c = (from_c or "usd").lower()
    to_c = (to_c or "usd").lower()
    if from_c == to_c:
        today = time.strftime("%Y-%m-%d")
        return [{"date": today, "rate": 1.0}] * max(1, days)
    # 预生成日期列表（含今天）
    dates = []
    for i in range(days - 1, -1, -1):
        d = time.strftime("%Y-%m-%d", time.localtime(time.time() - i * 86400))
        dates.append(d)

    def fetch_day(d):
        key = f"hist:{from_c}:{d}"
        cached = _cache_get(key)
        if cached is not None:
            return d, cached
        try:
            url = HIST_URL.format(date=d, base=from_c)
            data = _fetch_json(url)
            rate = float(data.get(from_c, {}).get(to_c, 0.0))
        except Exception:
            rate = None
        _cache_put(key, rate, _HIST_TTL)
        return d, rate

    series = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        for d, rate in ex.map(fetch_day, dates):
            if rate is None:
                continue
            series.append({"date": d, "rate": rate})
    # 若当天历史尚未发布，用实时值兜底结尾
    if not series or series[-1]["date"] != dates[-1]:
        try:
            rt = get_rates(from_c).get(to_c)
            if rt:
                series.append({"date": dates[-1], "rate": rt})
        except Exception:
            pass
    return series


def convert(amount, from_c, to_c):
    """把 amount（以 from_c 计）换算成 to_c。"""
    from_c = (from_c or "usd").lower()
    to_c = (to_c or "usd").lower()
    if from_c == to_c:
        return float(amount)
    rates = get_rates(from_c)
    rate = rates.get(to_c)
    if rate is None:
        raise ValueError(f"不支持的货币对 / Unsupported pair: {from_c}->{to_c}")
    return float(amount) * rate


def currency_name(code):
    return FIAT.get((code or "").lower(), (code or "").upper())
