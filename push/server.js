// Servicio de notificaciones push de Hierro.
// Solo lo llama PocketBase por la red interna de Docker (nunca está expuesto a internet).
//
//   GET  /vapid-public              -> { publicKey }
//   POST /schedule  { key, at, subs, title, body, url }   (at = epoch ms)
//   POST /cancel    { key }
//
// Cada "key" (el id del usuario) tiene como máximo un aviso pendiente:
// programar uno nuevo reemplaza al anterior.

const http = require("http");
const fs = require("fs");
const path = require("path");
const webpush = require("web-push");

const PORT = Number(process.env.PORT || 3000);
const SECRET = process.env.PUSH_SECRET || "";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
const MAX_DELAY = 60 * 60 * 1000; // 1 hora

// --- claves VAPID: se generan una vez y se guardan ---
fs.mkdirSync(DATA_DIR, { recursive: true });
const keyFile = path.join(DATA_DIR, "vapid.json");
let vapid;
if (fs.existsSync(keyFile)) {
  vapid = JSON.parse(fs.readFileSync(keyFile, "utf8"));
} else {
  vapid = webpush.generateVAPIDKeys();
  fs.writeFileSync(keyFile, JSON.stringify(vapid, null, 2), { mode: 0o600 });
  console.log("Claves VAPID nuevas generadas en", keyFile);
}
webpush.setVapidDetails(SUBJECT, vapid.publicKey, vapid.privateKey);

const pending = new Map(); // key -> timeout

async function deliver({ key, subs, title, body, url, tag }) {
  pending.delete(key);
  console.log(new Date().toISOString(), "enviando aviso a", (subs || []).length, "dispositivo(s)");
  const payload = JSON.stringify({ title, body, url, tag });
  const gone = [];
  await Promise.all(
    (subs || []).map(async (s) => {
      try {
        await webpush.sendNotification(s, payload, { TTL: 120, urgency: "high" });
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) gone.push(s.endpoint);
        else console.error("push error", err.statusCode || "", err.body || err.message);
      }
    })
  );
  if (gone.length) console.log("suscripciones vencidas:", gone.length);
  return gone;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 200_000) reject(new Error("too large"));
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); }
    });
  });
}

const send = (res, code, obj) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true, pending: pending.size });
    if (req.method === "GET" && req.url === "/vapid-public") return send(res, 200, { publicKey: vapid.publicKey });

    if (SECRET && req.headers["x-push-secret"] !== SECRET) return send(res, 401, { error: "unauthorized" });

    if (req.method === "POST" && req.url === "/schedule") {
      const b = await readJson(req);
      if (!b.key || !Array.isArray(b.subs)) return send(res, 400, { error: "key y subs son requeridos" });
      clearTimeout(pending.get(b.key));
      const delay = Math.max(0, Math.min(MAX_DELAY, Number(b.at) - Date.now()));
      const job = {
        key: b.key,
        subs: b.subs,
        title: b.title || "Descanso terminado",
        body: b.body || "¡A darle!",
        url: b.url || "/#/activo",
        tag: b.tag || "rest",
      };
      if (delay === 0) {
        const gone = await deliver(job);
        return send(res, 200, { sent: true, gone });
      }
      pending.set(b.key, setTimeout(() => deliver(job), delay));
      return send(res, 200, { scheduled: true, inMs: delay });
    }

    if (req.method === "POST" && req.url === "/cancel") {
      const b = await readJson(req);
      const had = pending.has(b.key);
      clearTimeout(pending.get(b.key));
      pending.delete(b.key);
      return send(res, 200, { cancelled: had });
    }

    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 400, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log(`push escuchando en :${PORT}`));
