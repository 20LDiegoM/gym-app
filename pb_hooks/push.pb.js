/// <reference path="../pb_data/types.d.ts" />

// Puente entre la app y el servicio "push" (contenedor interno).
// PUSH_URL    = http://push:3000 en docker-compose (vacío = notificaciones desactivadas)
// PUSH_SECRET = secreto compartido con el servicio push

// Clave pública VAPID (la app la necesita para suscribirse).
routerAdd("GET", "/api/gym/push-key", (e) => {
  const base = $os.getenv("PUSH_URL");
  if (!base) return e.json(200, { enabled: false });
  try {
    const res = $http.send({ url: base + "/vapid-public", timeout: 5 });
    if (res.statusCode !== 200) return e.json(200, { enabled: false });
    return e.json(200, { enabled: true, publicKey: res.json.publicKey });
  } catch (err) {
    return e.json(200, { enabled: false });
  }
});

// Programa el aviso de fin de descanso para todos los dispositivos del usuario.
// body: { at: epoch ms, label: "Press de banca" }
routerAdd("POST", "/api/gym/rest", (e) => {
  const base = $os.getenv("PUSH_URL");
  if (!base) return e.json(200, { enabled: false });
  const user = e.auth;
  const body = e.requestInfo().body || {};
  const at = Number(body.at) || 0;
  const label = String(body.label || "").slice(0, 80);

  const recs = e.app.findRecordsByFilter("push_subs", "user = {:u}", "", 20, 0, { u: user.id });
  if (!recs.length) return e.json(200, { scheduled: false, reason: "sin dispositivos" });
  const subs = recs.map((r) => JSON.parse(toString(r.get("sub"))));

  const res = $http.send({
    url: base + "/schedule",
    method: "POST",
    headers: { "content-type": "application/json", "x-push-secret": $os.getenv("PUSH_SECRET") || "" },
    body: JSON.stringify({
      key: user.id,
      at: at,
      subs: subs,
      title: "⏱ Descanso terminado",
      body: label ? "Siguiente serie: " + label : "¡A darle!",
      url: "/#/activo",
      tag: "rest",
    }),
    timeout: 10,
  });

  // borra suscripciones que el navegador ya dio de baja
  const gone = (res.json && res.json.gone) || [];
  for (const endpoint of gone) {
    try { e.app.delete(e.app.findFirstRecordByData("push_subs", "endpoint", endpoint)); } catch (_) {}
  }
  return e.json(res.statusCode, res.json || {});
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/gym/rest/cancel", (e) => {
  const base = $os.getenv("PUSH_URL");
  if (!base) return e.json(200, { enabled: false });
  const res = $http.send({
    url: base + "/cancel",
    method: "POST",
    headers: { "content-type": "application/json", "x-push-secret": $os.getenv("PUSH_SECRET") || "" },
    body: JSON.stringify({ key: e.auth.id }),
    timeout: 5,
  });
  return e.json(res.statusCode, res.json || {});
}, $apis.requireAuth("users"));
