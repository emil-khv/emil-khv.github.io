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

  if (text.startsWith("/start") || text.startsWith("/karta")) {
    const src = text.split(" ")[1] || "";
    const zk = src.match(/^zk(\d+)_([dp])$/);
    if (zk) {
      // Заявка из карточки ЖК на карте
      const z = await zkById(zk[1]);
      const name = z ? z.name : "ЖК #" + zk[1];
      const what = zk[2] === "p" ? "планировки и актуальные цены" : "подробности";
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
    ctx.waitUntil(handle(update, env).catch((e) => console.log("err", e && e.stack)));
    return new Response("ok");
  },
};
