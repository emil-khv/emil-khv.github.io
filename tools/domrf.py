import urllib.request, urllib.parse, re, json, time

BASE = "https://xn--80az8a.xn--d1aqf.xn--p1ai"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36", "Accept-Language": "ru-RU,ru"}

def get(url, n=None):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=12)
        b = r.read() if n is None else r.read(n)
        return r.status, r.headers.get("Content-Type", ""), b
    except urllib.error.HTTPError as e:
        return e.code, "", e.read()[:300]
    except Exception as e:
        return 0, "", repr(e).encode()

def q(path):
    return BASE + urllib.parse.quote(path, safe="/?=&:%")

def handler(event, context):
    out = []
    # 1. Ищем адреса API в скриптах сайта
    st, ct, html = get(q("/новостройки/хабаровск/"))
    html = html.decode("utf-8", "ignore")
    scripts = re.findall(r'src="([^"]+\.js[^"]*)"', html)
    out.append("scripts: " + " ".join(s[-60:] for s in scripts[:12]))
    found = set()
    for s in scripts[:12]:
        u = s if s.startswith("http") else BASE + s
        _, _, js = get(u)
        js = js.decode("utf-8", "ignore")
        for m in re.findall(r'["\'`](/(?:%D1%81%D0%B5%D1%80%D0%B2%D0%B8%D1%81%D1%8B|сервисы|api)[^"\'`\s]{2,90})', js):
            found.add(m)
    api = sorted(found)
    out.append(f"api ({len(api)}): " + " | ".join(api[:90]))
    # 2. Пробуем известные варианты
    cands = [
        "/сервисы/api/kn/object?offset=0&limit=3&sortField=devId.devShortCleanNm&sortType=asc&objStatus=0&place=27",
        "/сервисы/api/kn/object?offset=0&limit=3&place=27",
        "/сервисы/api/object/60474",
        "/сервисы/api/object/60474/documentation",
        "/сервисы/api/kn/object/60474",
        "/сервисы/api/kn/object/60474/documentation",
    ]
    for c in cands:
        st, ct, b = get(q(c), 4000)
        out.append(f"{c[:70]} -> {st} {ct[:25]} {b[:350].decode('utf-8','ignore')!r}")
    return {"statusCode": 200, "body": "\n".join(out)[:12000]}
