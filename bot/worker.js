// Бот @emil_khv_bot - ответчик на Cloudflare Workers.
// Секреты (Settings -> Variables and Secrets): BOT_TOKEN, WEBHOOK_SECRET, ADMIN_ID.

const MAP_URL = "https://emil-khv.github.io/";
const EMIL_URL = "https://t.me/emilenin";

const WELCOME =
  "Привет! Это бот Эмиля - агента по новостройкам Хабаровска.\n\n" +
  "Здесь все новостройки города на одной карте: где дороже, где дешевле, " +
  "сроки сдачи и отделка.\n\n" +
  "Жми «Открыть карту». А если нужен живой подбор под твой бюджет - " +
  "напиши Эмилю, он ответит лично.";

const KEYBOARD = {
  inline_keyboard: [
    [{ text: "Открыть карту", web_app: { url: MAP_URL } }],
    [{ text: "Написать Эмилю", url: EMIL_URL }],
  ],
};

async function tg(env, method, body) {
  const r = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

// ---- /osm: разовая выгрузка инфраструктуры из OpenStreetMap (команда только для Эмиля) ----
const OSM_BBOX = "48.30,134.90,48.65,135.30";
const OSM_Q = "[out:csv(::lat,::lon,amenity,shop,highway,railway,leisure;false;\"|\")][timeout:120];(" +
  "nwr[amenity~\"^(school|kindergarten|clinic|hospital|doctors|pharmacy)$\"](" + OSM_BBOX + ");" +
  "nwr[shop~\"^(supermarket|convenience|mall)$\"](" + OSM_BBOX + ");" +
  "node[highway=bus_stop](" + OSM_BBOX + ");node[railway=tram_stop](" + OSM_BBOX + ");" +
  "nwr[leisure~\"^(park|playground|sports_centre|fitness_centre)$\"](" + OSM_BBOX + ");" +
  ");out center;";
const OSM_EPS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.private.coffee/api/interpreter"];

async function osmRun(env) {
  const zk = (await fetch(MAP_URL + "data/zk.json").then((r) => r.json())).items;
  let txt = null, used = ""; const errs = [];
  for (const e of OSM_EPS) {
    try {
      const r = await fetch(e, { method: "POST", body: "data=" + encodeURIComponent(OSM_Q), headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "emil-khv-map/1.0" } });
      if (r.ok) { txt = await r.text(); used = e; break; }
      else errs.push(e.split("/")[2] + " " + r.status);
    } catch (x) { errs.push(e.split("/")[2] + " " + x.message); }
  }
  if (!txt) throw new Error("OpenStreetMap не ответил: " + errs.join("; "));
  const K = ["school", "kg", "shop", "stop", "med", "park"];
  const pts = [];
  for (const line of txt.split("\n")) {
    const f = line.split("|"); if (f.length < 7 || !f[0]) continue;
    const am = f[2], c = am === "school" ? 0 : am === "kindergarten" ? 1 : am ? 4 : f[3] ? 2 : (f[4] || f[5]) ? 3 : f[6] ? 5 : -1;
    if (c >= 0) pts.push(+f[0], +f[1], c);
  }
  const out = {};
  const kx = 111320 * Math.cos(48.48 * Math.PI / 180), ky = 110540;
  for (const z of zk) {
    const n = K.map(() => [0, 0, null]);
    for (let i = 0; i < pts.length; i += 3) {
      const dy = (pts[i] - z.lat) * ky; if (dy > 3000 || dy < -3000) continue;
      const dx = (pts[i + 1] - z.lng) * kx; if (dx > 3000 || dx < -3000) continue;
      const d = Math.sqrt(dx * dx + dy * dy); if (d > 3000) continue;
      const a = n[pts[i + 2]];
      if (d <= 500) a[0]++;
      if (d <= 1000) a[1]++;
      if (a[2] == null || d < a[2]) a[2] = Math.round(d);
    }
    const o = {}; K.forEach((k, j) => (o[k] = n[j])); out[z.id] = o;
  }
  const body = JSON.stringify({ updated: new Date().toISOString().slice(0, 10), source: used, points: pts.length / 3, near: out });
  const api = "https://api.github.com/repos/emil-khv/emil-khv.github.io/contents/data/nearby.json";
  const H = { Authorization: "Bearer " + env.GH_TOKEN, "User-Agent": "emil-khv-map", Accept: "application/vnd.github+json", "Content-Type": "application/json" };
  const g = await fetch(api, { headers: H });
  const sha = g.ok ? (await g.json()).sha : undefined;
  const p = await fetch(api, { method: "PUT", headers: H, body: JSON.stringify({ message: "OSM: инфраструктура рядом с ЖК", content: btoa(unescape(encodeURIComponent(body))), sha }) });
  return "объектов " + pts.length / 3 + ", ЖК " + zk.length + ", GitHub " + p.status;
}

let ZK = null, ZK_AT = 0;
async function zkById(id) {
  try {
    if (!ZK || Date.now() - ZK_AT > 3600e3) {
      const d = await fetch(MAP_URL + "data/zk.json").then((r) => r.json());
      ZK = d.items; ZK_AT = Date.now();
    }
    return ZK.find((z) => String(z.id) === String(id)) || null;
  } catch (e) { return null; }
}

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function who(u) {
  const name = esc([u.first_name, u.last_name].filter(Boolean).join(" "));
  const nick = u.username ? " @" + esc(u.username) : "";
  return name + nick + ' <a href="tg://user?id=' + u.id + '">профиль</a> #id' + u.id;
}

async function handle(update, env) {
  const msg = update.message;
  if (!msg || !msg.from) return;
  const u = msg.from;
  const admin = String(env.ADMIN_ID);
  const text = msg.text || "";

  // Эмиль отвечает на уведомление -> ответ уходит человеку от имени бота
  if (String(u.id) === admin && msg.reply_to_message) {
    const m = (msg.reply_to_message.text || "").match(/#id(\d+)/);
    if (m) {
      const res = await tg(env, "copyMessage", { chat_id: m[1], from_chat_id: admin, message_id: msg.message_id });
      await tg(env, "sendMessage", {
        chat_id: admin,
        text: res.ok ? "Отправил." : "Не дошло: " + (res.description || "ошибка"),
        reply_to_message_id: msg.message_id,
      });
      return;
    }
  }

  if (String(u.id) === admin && text === "/osm") {
    await tg(env, "sendMessage", { chat_id: admin, text: "Выгружаю школы, сады, магазины и остановки из OpenStreetMap..." });
    let res;
    const t0 = Date.now();
    try { res = "Готово: " + (await osmRun(env)) + ", " + Math.round((Date.now() - t0) / 1000) + " с"; } catch (e) { res = "Не получилось: " + e.message; }
    await tg(env, "sendMessage", { chat_id: admin, text: res });
    return;
  }

  if (text.startsWith("/start") || text.startsWith("/karta")) {
    const src = text.split(" ")[1] || "";
    const zk = src.match(/^zk(\d+)_([dpi])$/);
    const fav = src.match(/^fav_([\d-]+)$/);
    if (zk) {
      // Заявка из карточки ЖК на карте
      const z = await zkById(zk[1]);
      const name = z ? z.name : "ЖК #" + zk[1];
      const what = zk[2] === "p" ? "планировки и актуальные цены" : zk[2] === "i" ? "точный расчёт ипотеки" : "подробности";
      await tg(env, "sendMessage", {
        chat_id: u.id,
        text: "Принял! Эмиль пришлёт " + what + " по ЖК «" + name + "» сюда или в личку.\n\n" +
          "Чтобы подобрать точнее, напиши в ответ: сколько комнат, бюджет и как планируешь покупать (ипотека, наличные, сертификат).",
        reply_markup: KEYBOARD,
      });
      await tg(env, "sendMessage", {
        chat_id: admin,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        text: "ЗАЯВКА с карты: " + what + "\nЖК «" + esc(name) + "»" + (z ? " (" + esc(z.district) + (z.pmin ? ", от " + z.pmin + " млн" : "") + ")" : "") + "\n" + who(u) +
          "\n\nОтветь на это сообщение (свайп), и бот перешлёт ответ.",
      });
      return;
    }
    if (fav) {
      // Подборка из избранного
      const ids = fav[1].split("-").slice(0, 12);
      const items = [];
      for (const id of ids) { const z = await zkById(id); if (z) items.push(z); }
      const lines = items.map((z) => "- " + z.name + " (" + z.district + (z.pmin ? ", от " + z.pmin + " млн" : "") + ")").join("\n");
      await tg(env, "sendMessage", {
        chat_id: u.id,
        text: "Подборка у Эмиля:\n" + lines + "\n\nОн проверит свободные квартиры и условия и напишет. Чтобы было точнее, напиши в ответ: комнаты, бюджет и как планируешь покупать.",
        reply_markup: KEYBOARD,
      });
      await tg(env, "sendMessage", {
        chat_id: admin,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        text: "ЗАЯВКА: подборка из избранного (" + items.length + " ЖК)\n" + esc(lines) + "\n" + who(u) + "\n\nОтветь на это сообщение (свайп), и бот перешлёт ответ.",
      });
      return;
    }
    await tg(env, "sendMessage", { chat_id: u.id, text: WELCOME, reply_markup: KEYBOARD });
    if (String(u.id) !== admin) {
      await tg(env, "sendMessage", {
        chat_id: admin,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        text: "Новый человек в боте карты\n" + who(u) + (src ? "\nОткуда: " + esc(src) : ""),
      });
    }
    return;
  }

  // Любое другое сообщение -> пересылаем Эмилю, человеку подтверждаем
  if (String(u.id) !== admin) {
    await tg(env, "sendMessage", {
      chat_id: admin,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      text: "Сообщение в боте карты\n" + who(u) + "\n\n" + esc(text || "[не текст - ниже]") + "\n\nОтветь на это сообщение (свайп), и бот перешлёт ответ.",
    });
    if (!text) await tg(env, "forwardMessage", { chat_id: admin, from_chat_id: u.id, message_id: msg.message_id });
    await tg(env, "sendMessage", {
      chat_id: u.id,
      text: "Передал Эмилю, он скоро ответит. А пока можно посмотреть карту.",
      reply_markup: KEYBOARD,
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("ok");
    if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const update = await request.json();
    const t = update.message && update.message.text;
    if (t === "/osm") {
      // долгая разовая задача: выполняем до ответа, чтобы её не оборвал лимит фоновой работы
      await handle(update, env).catch((e) => console.log("err", e && e.stack));
      return new Response("ok");
    }
    ctx.waitUntil(handle(update, env).catch((e) => console.log("err", e && e.stack)));
    return new Response("ok");
  },
};
