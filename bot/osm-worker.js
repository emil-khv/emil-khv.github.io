// Временный воркер: раз в минуту по cron считает инфраструктуру рядом с ЖК из OSM и кладёт data/nearby.json в GitHub.
const BBOX = "48.30,134.90,48.65,135.30";
const Q = "[out:json][timeout:120];(" +
  "nwr[amenity~\"^(school|kindergarten|clinic|hospital|doctors|pharmacy)$\"](" + BBOX + ");" +
  "nwr[shop~\"^(supermarket|convenience|mall)$\"](" + BBOX + ");" +
  "node[highway=bus_stop](" + BBOX + ");node[railway=tram_stop](" + BBOX + ");" +
  "nwr[leisure~\"^(park|playground|sports_centre|fitness_centre)$\"](" + BBOX + ");" +
  ");out center tags;";
const EPS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];

function cat(t) {
  if (t.amenity === "school") return "school";
  if (t.amenity === "kindergarten") return "kg";
  if (["clinic", "hospital", "doctors", "pharmacy"].includes(t.amenity)) return "med";
  if (t.shop) return "shop";
  if (t.highway === "bus_stop" || t.railway === "tram_stop") return "stop";
  if (t.leisure) return "park";
  return null;
}
function dist(a, b, c, d) {
  const R = 6371000, r = (x) => x * Math.PI / 180, dla = r(c - a), dlo = r(d - b);
  const h = Math.sin(dla / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function run(env) {
  const zk = (await fetch("https://emil-khv.github.io/data/zk.json").then((r) => r.json())).items;
  let els = null, used = "";
  for (const e of EPS) {
    try {
      const r = await fetch(e, { method: "POST", body: "data=" + encodeURIComponent(Q), headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "emil-khv-map/1.0" } });
      if (r.ok) { els = (await r.json()).elements; used = e; break; }
    } catch (x) {}
  }
  if (!els) throw new Error("overpass недоступен");
  const pts = [];
  for (const el of els) {
    const c = cat(el.tags || {}); if (!c) continue;
    const lat = el.lat ?? (el.center && el.center.lat), lon = el.lon ?? (el.center && el.center.lon);
    if (lat == null) continue;
    pts.push([c, lat, lon]);
  }
  const out = {};
  for (const z of zk) {
    const n = {};
    for (const k of ["school", "kg", "shop", "stop", "med", "park"]) n[k] = [0, 0, null];
    for (const [c, lat, lon] of pts) {
      const d = dist(z.lat, z.lng, lat, lon);
      if (d > 3000) continue;
      const a = n[c];
      if (d <= 500) a[0]++;
      if (d <= 1000) a[1]++;
      if (a[2] == null || d < a[2]) a[2] = Math.round(d);
    }
    out[z.id] = n;
  }
  const body = JSON.stringify({ updated: new Date().toISOString().slice(0, 10), source: used, points: pts.length, near: out });
  const api = "https://api.github.com/repos/emil-khv/emil-khv.github.io/contents/data/nearby.json";
  const H = { Authorization: "Bearer " + env.GH_TOKEN, "User-Agent": "emil-khv-map", Accept: "application/vnd.github+json", "Content-Type": "application/json" };
  const g = await fetch(api, { headers: H });
  const sha = g.ok ? (await g.json()).sha : undefined;
  const b64 = btoa(unescape(encodeURIComponent(body)));
  const p = await fetch(api, { method: "PUT", headers: H, body: JSON.stringify({ message: "OSM: инфраструктура рядом с ЖК", content: b64, sha }) });
  return p.status;
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(run(env).then((s) => console.log("ok", s)).catch((e) => console.log("err", e.message))); },
  async fetch() { return new Response("ok"); },
};
