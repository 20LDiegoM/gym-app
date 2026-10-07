import PocketBase from "./vendor/pocketbase.es.mjs";

// =====================================================================
//  Hierro — registro de gym sencillo, multiusuario, para PocketBase
// =====================================================================

const pb = new PocketBase(location.origin);
pb.autoCancellation(false);

const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const key = (k) => `hierro.${pb.authStore.record?.id || "anon"}.${k}`;

const MUSCLES = {
  pecho: "Pecho", espalda: "Espalda", piernas: "Piernas", gluteos: "Glúteos", hombros: "Hombros",
  biceps: "Bíceps", triceps: "Tríceps", antebrazos: "Antebrazos", core: "Core", cardio: "Cardio", otro: "Otro",
};
const PLATES = { kg: [25, 20, 15, 10, 5, 2.5, 1.25], lb: [45, 35, 25, 10, 5, 2.5] };
const PLATE_COLORS = { 25: "#e5484d", 20: "#3e8ef7", 15: "#f5c518", 10: "#4cc38a", 5: "#f1f1f1", 2.5: "#c2c2c2", 1.25: "#9a9a9a", 45: "#3e8ef7", 35: "#f5c518", 0: "#999" };

// ------------------------------ estado ------------------------------
const S = {
  exercises: [],      // todos los visibles (globales + propios)
  exMap: new Map(),
  routines: [],
  workouts: [],       // del más reciente al más antiguo
  active: null,       // entreno en curso
  config: { inviteRequired: false },
};

// ------------------------------ utilidades ------------------------------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };
const fmt = (n, d = 1) => (n == null ? "–" : (Math.round(n * 10 ** d) / 10 ** d).toLocaleString("es"));
const e1rm = (w, r) => (!w || !r ? 0 : r === 1 ? w : w * (1 + r / 30));
const unit = () => pb.authStore.record?.unit || "kg";
const defaultRest = () => pb.authStore.record?.rest_seconds || 90;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const pbDate = (d) => new Date(d).toISOString().replace("T", " ");
const parseDate = (s) => new Date(String(s).replace(" ", "T"));
const fmtDate = (d, opts = { weekday: "short", day: "numeric", month: "short" }) => parseDate(d).toLocaleDateString("es", opts);
const mmss = (sec) => { sec = Math.max(0, Math.round(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; };
const duration = (a, b) => {
  const m = Math.round((parseDate(b) - parseDate(a)) / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};
const exName = (id, fallback) => S.exMap.get(id)?.name || fallback || "Ejercicio";
const exImg = (id, frame = 0) => { const m = S.exMap.get(id)?.media; return m ? `ex/${encodeURIComponent(m)}/${frame}.jpg` : ""; };
const thumb = (id, cls = "thumb") => {
  const src = exImg(id);
  const ex = S.exMap.get(id);
  return src ? `<img class="${cls}" src="${src}" alt="" loading="lazy">` : `<span class="${cls} ph">${esc((ex?.name || "?").slice(0, 1))}</span>`;
};

function toast(msg, cls = "") {
  const t = $("#toast");
  t.textContent = msg; t.className = `toast ${cls}`; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
}

function buzz(p) { try { navigator.vibrate?.(p); } catch {} }

let audioCtx;
function beep() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach((t) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.25, audioCtx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + t + 0.18);
      o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.2);
    });
  } catch {}
}

// ------------------------------ datos ------------------------------
function cacheData() {
  LS.set(key("cache"), { exercises: S.exercises, routines: S.routines, workouts: S.workouts });
}
function setExercises(list) {
  S.exercises = list.sort((a, b) => a.name.localeCompare(b.name, "es"));
  S.exMap = new Map(S.exercises.map((e) => [e.id, e]));
}

async function loadAll() {
  const cached = LS.get(key("cache"));
  if (cached) {
    setExercises(cached.exercises || []);
    S.routines = cached.routines || [];
    S.workouts = cached.workouts || [];
  }
  S.active = LS.get(key("active"), null);
  try {
    const [ex, rt, wk] = await Promise.all([
      pb.collection("exercises").getFullList({ sort: "name" }),
      pb.collection("routines").getFullList({ sort: "-updated" }),
      pb.collection("workouts").getFullList({ sort: "-started" }),
    ]);
    setExercises(ex);
    S.routines = rt;
    S.workouts = wk;
    cacheData();
  } catch (e) {
    if (e?.status === 401) return logout();
  }
  await flushQueue();
}

// Cola de entrenos pendientes (para guardar sin conexión)
let flushing = null;
function flushQueue(silent = false) {
  flushing ||= doFlush(silent).finally(() => (flushing = null));
  return flushing;
}
async function doFlush(silent) {
  const q = LS.get(key("queue"), []);
  if (!q.length) return;
  const rest = [];
  for (const item of q) {
    try {
      const rec = await pb.collection("workouts").create(item);
      S.workouts = [rec, ...S.workouts.filter((w) => w.client_id !== item.client_id)];
    } catch (e) {
      // 400 por client_id duplicado = ya se guardó antes
      if (e?.status === 400 && e?.response?.data?.client_id) {
        S.workouts = S.workouts.map((w) => (w.client_id === item.client_id && w._pending ? { ...w, _pending: false } : w));
        continue;
      }
      rest.push(item);
    }
  }
  LS.set(key("queue"), rest);
  S.workouts.sort((a, b) => parseDate(b.started) - parseDate(a.started));
  cacheData();
  if (!silent && !rest.length) toast("Entrenos sincronizados");
}

// ------------------------------ historial por ejercicio ------------------------------
function doneSets(entry) { return (entry?.sets || []).filter((s) => s.done && (num(s.r) || num(s.w))); }

function lastPerformance(exId, excludeClientId) {
  for (const w of S.workouts) {
    if (excludeClientId && w.client_id === excludeClientId) continue;
    const e = (w.data || []).find((x) => x.exercise === exId);
    if (e && doneSets(e).length) return doneSets(e);
  }
  return null;
}

function exerciseHistory(exId) {
  const out = [];
  for (const w of S.workouts) {
    const e = (w.data || []).find((x) => x.exercise === exId);
    if (!e) continue;
    const sets = doneSets(e);
    if (!sets.length) continue;
    let best1 = 0, bestW = 0, vol = 0, bestSet = null;
    for (const s of sets) {
      const W = num(s.w) || 0, R = num(s.r) || 0;
      const v = e1rm(W, R);
      if (v > best1) { best1 = v; bestSet = s; }
      if (W > bestW) bestW = W;
      vol += W * R;
    }
    out.push({ workout: w, date: w.started, sets, best1, bestW, vol, bestSet });
  }
  return out; // reciente → antiguo
}

function bestE1rm(exId, excludeClientId) {
  let b = 0;
  for (const h of exerciseHistory(exId)) {
    if (excludeClientId && h.workout.client_id === excludeClientId) continue;
    b = Math.max(b, h.best1);
  }
  return b;
}

// ------------------------------ router ------------------------------
const routes = [
  [/^#\/?$/, renderHome, "home"],
  [/^#\/activo$/, renderActive, null],
  [/^#\/rutinas$/, renderRoutines, "rutinas"],
  [/^#\/rutina\/(.+)$/, renderRoutineEdit, "rutinas"],
  [/^#\/historial$/, renderHistory, "historial"],
  [/^#\/entreno\/(.+)$/, renderWorkoutDetail, "historial"],
  [/^#\/progreso$/, renderProgress, "progreso"],
  [/^#\/progreso\/(.+)$/, renderExerciseProgress, "progreso"],
  [/^#\/perfil$/, renderProfile, "perfil"],
];

function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

function route() {
  closeModal();
  if (!pb.authStore.isValid) { $("#tabs").hidden = true; return renderAuth(); }
  const h = location.hash || "#/";
  for (const [re, fn, tab] of routes) {
    const m = h.match(re);
    if (m) {
      $("#tabs").hidden = false;
      document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));
      window.scrollTo(0, 0);
      return fn(...m.slice(1).map(decodeURIComponent));
    }
  }
  go("#/");
}
window.addEventListener("hashchange", route);

// ------------------------------ auth ------------------------------
function renderAuth(mode = "login") {
  const reg = mode === "register";
  view.innerHTML = `
    <div class="auth">
      <p class="brand">Hierro<i>.</i></p>
      <p class="sub">Tu registro de gym. Rápido entre series.</p>
      <form id="authForm">
        ${reg ? `<label class="f">Nombre</label><input class="in" name="name" autocomplete="name" required>` : ""}
        <label class="f">Correo</label>
        <input class="in" name="email" type="email" autocomplete="email" required>
        <label class="f">Contraseña</label>
        <input class="in" name="password" type="password" minlength="8" autocomplete="${reg ? "new-password" : "current-password"}" required>
        ${reg && S.config.inviteRequired ? `<label class="f">Código de invitación</label><input class="in" name="invite" required autocapitalize="off">` : ""}
        <div class="err" id="authErr"></div>
        <button class="btn primary block" style="margin-top:8px">${reg ? "Crear cuenta" : "Entrar"}</button>
      </form>
      <p class="sub" style="text-align:center;margin-top:20px">
        ${reg ? "¿Ya tienes cuenta?" : "¿Primera vez?"}
        <button class="link" id="authSwap">${reg ? "Entrar" : "Crear cuenta"}</button>
      </p>
    </div>`;
  $("#authSwap").onclick = () => renderAuth(reg ? "login" : "register");
  $("#authForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    const btn = ev.target.querySelector("button"); btn.disabled = true;
    try {
      if (reg) {
        await pb.collection("users").create({ ...f, passwordConfirm: f.password, unit: "kg", rest_seconds: 90 });
      }
      await pb.collection("users").authWithPassword(f.email, f.password);
      await loadAll();
      go("#/");
    } catch (e) {
      const d = e?.response?.data || {};
      const first = Object.values(d)[0]?.message;
      $("#authErr").textContent = e?.status === 400 && !reg ? "Correo o contraseña incorrectos." : (e?.response?.message && !first ? e.response.message : first) || "No se pudo completar. ¿Hay conexión?";
      btn.disabled = false;
    }
  };
}

async function logout() {
  if (pushOn()) { cancelPush(); await disablePush(); }
  pb.authStore.clear();
  S.exercises = []; S.routines = []; S.workouts = []; S.active = null;
  stopTimer();
  go("#/");
}

// ------------------------------ inicio ------------------------------
function renderHome() {
  const now = new Date();
  const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const thisWeek = S.workouts.filter((w) => parseDate(w.started) >= monday).length;
  const last = S.workouts[0];
  const streak = weekStreak();
  const name = pb.authStore.record?.name?.split(" ")[0] || "";

  view.innerHTML = `
    <div class="top"><h1>${name ? `Hola, ${esc(name)}` : "Entrenar"}</h1></div>
    ${S.active ? `
      <button class="hero" id="resume"><b>Continuar entreno</b><span>${esc(S.active.name)} · empezó hace ${duration(S.active.started, new Date())}</span></button>
    ` : `
      <button class="hero" id="startEmpty"><b>Empezar entreno vacío</b><span>Añade ejercicios sobre la marcha</span></button>
    `}
    <div class="stats">
      <div class="stat"><b>${thisWeek}</b><span>esta semana</span></div>
      <div class="stat"><b>${streak}</b><span>semanas seguidas</span></div>
      <div class="stat"><b>${S.workouts.length}</b><span>entrenos totales</span></div>
    </div>
    <h2>Empezar desde una rutina</h2>
    ${S.routines.length ? S.routines.map((r) => `
      <div class="card list-item">
        <div style="min-width:0">
          <h3>${esc(r.name)}</h3>
          <div class="sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${(r.items || []).map((i) => esc(exName(i.exercise))).join(" · ") || "Sin ejercicios"}</div>
        </div>
        <button class="btn sm primary" data-start="${r.id}">Empezar</button>
      </div>`).join("") : `<div class="card empty">Aún no tienes rutinas.<br><br><a class="btn sm" href="#/rutina/nueva">Crear rutina</a></div>`}
    ${last ? `<h2>Último entreno</h2>${workoutCard(last)}` : ""}
  `;
  $("#resume")?.addEventListener("click", () => go("#/activo"));
  $("#startEmpty")?.addEventListener("click", () => startWorkout());
  view.querySelectorAll("[data-start]").forEach((b) => (b.onclick = () => startWorkout(S.routines.find((r) => r.id === b.dataset.start))));
  view.querySelectorAll("[data-wk]").forEach((b) => (b.onclick = () => go(`#/entreno/${b.dataset.wk}`)));
}

function weekStreak() {
  if (!S.workouts.length) return 0;
  const weekId = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.getTime(); };
  const weeks = new Set(S.workouts.map((w) => weekId(parseDate(w.started))));
  let cur = weekId(new Date()), n = 0;
  if (!weeks.has(cur)) cur -= 7 * 864e5; // la semana actual aún puede estar en curso
  while (weeks.has(cur)) { n++; cur -= 7 * 864e5; }
  return n;
}

// ------------------------------ entreno activo ------------------------------
function saveActive() { if (S.active) LS.set(key("active"), S.active); else LS.del(key("active")); }

function newSetsFor(exId, count = 1) {
  return Array.from({ length: Math.max(1, count) }, () => ({ w: "", r: "", rpe: "", done: false }));
}

function startWorkout(routine = null, fromWorkout = null) {
  if (S.active && !confirm("Ya tienes un entreno en curso. ¿Descartarlo y empezar otro?")) return go("#/activo");
  const exercises = routine
    ? (routine.items || []).map((i) => ({ exercise: i.exercise, name: exName(i.exercise), rest: i.rest || defaultRest(), target: i.reps || "", sets: newSetsFor(i.exercise, i.sets || 3) }))
    : fromWorkout
      ? (fromWorkout.data || []).map((e) => ({ exercise: e.exercise, name: exName(e.exercise, e.name), rest: e.rest || defaultRest(), target: e.target || "", sets: newSetsFor(e.exercise, doneSets(e).length || 3) }))
      : [];
  const d = new Date();
  const autoName = d.getHours() < 12 ? "Entreno de la mañana" : d.getHours() < 18 ? "Entreno de la tarde" : "Entreno de la noche";
  S.active = {
    client_id: uid(),
    name: routine?.name || fromWorkout?.name || autoName,
    routine: routine?.id || "",
    started: d.toISOString(),
    notes: "",
    exercises,
  };
  saveActive();
  go("#/activo");
}

let clockInt;
function renderActive() {
  const A = S.active;
  if (!A) return go("#/");
  const u = unit();
  view.innerHTML = `
    <div class="wk-head">
      <div class="row">
        <div class="grow"><input class="wk-name" id="wkName" value="${esc(A.name)}" aria-label="Nombre del entreno"></div>
        <button class="btn sm primary" id="finish">Terminar</button>
      </div>
      <div class="row" style="margin-top:4px">
        <div class="clock grow num" id="clock"></div>
        <button class="btn sm ghost" id="plateBtn" title="Calculadora de discos">Discos</button>
      </div>
    </div>
    ${pushBanner()}
    <div id="exList">${A.exercises.map((e, i) => exerciseBlock(e, i, u)).join("")}</div>
    ${A.exercises.length ? "" : `<div class="empty">Añade tu primer ejercicio para empezar.</div>`}
    <div class="stack" style="margin-top:16px">
      <button class="btn block" id="addEx">+ Añadir ejercicio</button>
      <textarea class="in" id="wkNotes" placeholder="Notas del entreno (opcional)">${esc(A.notes)}</textarea>
      <button class="btn ghost danger block" id="discard">Descartar entreno</button>
    </div>
  `;
  $("#pushOn")?.addEventListener("click", async (ev) => {
    ev.target.disabled = true;
    try { await enablePush(); toast("🔔 Listo: el descanso sonará aunque bloquees el teléfono"); }
    catch (err) { toast(err.message || "No se pudo activar"); }
    renderActive();
  });
  $("#pushNo")?.addEventListener("click", () => { LS.set(key("pushAsked"), true); renderActive(); });
  const tick = () => { const c = $("#clock"); if (c) c.textContent = `⏱ ${mmss((Date.now() - new Date(A.started)) / 1000)}`; };
  clearInterval(clockInt); tick(); clockInt = setInterval(() => { if (!$("#clock")) return clearInterval(clockInt); tick(); }, 1000);

  $("#wkName").oninput = (e) => { A.name = e.target.value; saveActive(); };
  $("#wkNotes").oninput = (e) => { A.notes = e.target.value; saveActive(); };
  $("#addEx").onclick = () => pickExercise((ex) => {
    const last = lastPerformance(ex.id);
    A.exercises.push({ exercise: ex.id, name: ex.name, rest: defaultRest(), target: "", sets: newSetsFor(ex.id, last?.length || 3) });
    saveActive(); renderActive();
    setTimeout(() => view.querySelector(`[data-ex="${A.exercises.length - 1}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  });
  $("#discard").onclick = () => {
    if (!confirm("¿Descartar este entreno? No se guardará nada.")) return;
    S.active = null; saveActive(); stopTimer(); go("#/");
  };
  $("#finish").onclick = finishWorkout;
  $("#plateBtn").onclick = () => plateModal();

  // Delegación de eventos para la tabla de series
  const list = $("#exList");
  list.oninput = (ev) => {
    const t = ev.target; if (!t.dataset.f) return;
    const [ei, si] = [Number(t.dataset.e), Number(t.dataset.s)];
    A.exercises[ei].sets[si][t.dataset.f] = t.value;
    saveActive();
  };
  list.onclick = (ev) => {
    const t = ev.target.closest("button"); if (!t) return;
    const ei = Number(t.dataset.e), si = Number(t.dataset.s);
    const ex = A.exercises[ei];
    if (t.dataset.act === "check") toggleSet(ei, si);
    if (t.dataset.act === "addset") {
      const prev = ex.sets[ex.sets.length - 1];
      ex.sets.push({ w: prev?.w || "", r: prev?.r || "", rpe: "", done: false });
      saveActive(); refreshExercise(ei);
    }
    if (t.dataset.act === "delset") {
      ex.sets.splice(si, 1);
      if (!ex.sets.length) ex.sets.push(...newSetsFor(ex.exercise));
      saveActive(); refreshExercise(ei);
    }
    if (t.dataset.act === "menu") exerciseMenu(ei);
    if (t.dataset.act === "info") exerciseInfo(ex.exercise);
  };
}

function pushBanner() {
  if (pushOn() || LS.get(key("pushAsked"), false)) return "";
  if (pushSupported() && Notification.permission === "denied") return "";
  const ios = isIOS && !isStandalone();
  return `<div class="card notice">
    <b>🔔 ¿Aviso cuando termine el descanso?</b>
    <div class="sub">${ios ? "Para que suene con el teléfono bloqueado, instala Hierro: Compartir → Agregar a pantalla de inicio, y ábrela desde el ícono." : "Así suena y vibra aunque bloquees el teléfono."}</div>
    <div class="row" style="margin-top:10px">${ios ? "" : `<button class="btn sm primary" id="pushOn">Activar</button>`}<button class="btn sm ghost" id="pushNo">${ios ? "Entendido" : "Ahora no"}</button></div>
  </div>`;
}

function exerciseBlock(e, i, u) {
  const prev = lastPerformance(e.exercise, S.active.client_id) || [];
  const best = bestE1rm(e.exercise, S.active.client_id);
  return `
  <section class="ex" data-ex="${i}">
    <div class="ex-top">
      <button class="ex-info" data-act="info" data-e="${i}" aria-label="Ver técnica">${thumb(e.exercise)}</button>
      <h3><button class="ex-name" data-act="info" data-e="${i}">${esc(exName(e.exercise, e.name))}</button></h3>
      <button class="icon-btn" data-act="menu" data-e="${i}" aria-label="Opciones">⋯</button>
    </div>
    ${e.target || e.rest ? `<div class="ex-note">${e.target ? `Objetivo: ${esc(e.target)} reps · ` : ""}Descanso ${mmss(e.rest || defaultRest())}</div>` : ""}
    <table class="sets">
      <thead><tr><th>Serie</th><th>Anterior</th><th>${u}</th><th>Reps</th><th>✓</th><th></th></tr></thead>
      <tbody>
        ${e.sets.map((s, si) => {
          const p = prev[si];
          const isPr = s.done && best > 0 && s._pr;
          return `<tr class="${s.done ? "done" : ""}">
            <td class="n">${si + 1}</td>
            <td class="prev">${p ? `${fmt(num(p.w))}×${fmt(num(p.r), 0)}` : "—"}${isPr ? ` <span class="pr-badge">🏆</span>` : ""}</td>
            <td><input inputmode="decimal" enterkeyhint="next" data-f="w" data-e="${i}" data-s="${si}" value="${esc(s.w)}" placeholder="${p ? esc(p.w) : ""}" aria-label="Peso"></td>
            <td><input inputmode="numeric" enterkeyhint="done" data-f="r" data-e="${i}" data-s="${si}" value="${esc(s.r)}" placeholder="${p ? esc(p.r) : esc(String(e.target || "").split("-")[0])}" aria-label="Reps"></td>
            <td><button class="ck" data-act="check" data-e="${i}" data-s="${si}" aria-label="Completar serie">✓</button></td>
            <td><button class="set-del" data-act="delset" data-e="${i}" data-s="${si}" aria-label="Borrar serie">×</button></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    <div class="ex-foot">
      <button class="btn sm ghost" data-act="addset" data-e="${i}">+ Serie</button>
      ${best ? `<span class="sub num">Mejor 1RM est.: ${fmt(best)} ${u}</span>` : ""}
    </div>
  </section>`;
}

function refreshExercise(ei) {
  const el = view.querySelector(`[data-ex="${ei}"]`);
  if (!el) return renderActive();
  el.outerHTML = exerciseBlock(S.active.exercises[ei], ei, unit());
}

function toggleSet(ei, si) {
  const ex = S.active.exercises[ei];
  const s = ex.sets[si];
  if (!s.done) {
    // si están vacíos, usar lo de la vez pasada (el placeholder)
    const row = view.querySelector(`[data-ex="${ei}"] tbody tr:nth-child(${si + 1})`);
    if (s.w === "") s.w = row?.querySelector('[data-f="w"]')?.placeholder || "";
    if (s.r === "") s.r = row?.querySelector('[data-f="r"]')?.placeholder || "";
    if (num(s.r) == null && num(s.w) == null) { toast("Pon el peso y las reps"); return; }
    s.done = true;
    // ¿récord personal?
    const val = e1rm(num(s.w) || 0, num(s.r) || 0);
    const histBest = bestE1rm(ex.exercise, S.active.client_id);
    const sessionBest = Math.max(0, ...ex.sets.filter((x, j) => j !== si && x.done).map((x) => e1rm(num(x.w) || 0, num(x.r) || 0)));
    s._pr = histBest > 0 && val > histBest && val > sessionBest;
    if (s._pr) { toast(`🏆 ¡Nuevo récord! ${fmt(val)} ${unit()} 1RM estimado`, "gold"); buzz([60, 40, 60]); }
    else buzz(25);
    startTimer(ex.rest || defaultRest(), exName(ex.exercise, ex.name));
  } else {
    s.done = false; s._pr = false;
  }
  saveActive(); refreshExercise(ei);
}

function exerciseMenu(ei) {
  const A = S.active, ex = A.exercises[ei];
  openModal(`
    <div class="sheet-head"><h2>${esc(exName(ex.exercise, ex.name))}</h2><button class="icon-btn" data-close>✕</button></div>
    <label class="f">Descanso entre series</label>
    <div class="chips" id="restChips">${[45, 60, 90, 120, 180, 240].map((s) => `<button class="chip ${ex.rest === s ? "on" : ""}" data-rest="${s}">${mmss(s)}</button>`).join("")}</div>
    <div class="stack" style="margin-top:20px">
      <button class="btn block" id="mUp" ${ei === 0 ? "disabled" : ""}>Mover arriba</button>
      <button class="btn block" id="mDown" ${ei === A.exercises.length - 1 ? "disabled" : ""}>Mover abajo</button>
      <button class="btn block" id="mSwap">Cambiar ejercicio</button>
      <button class="btn block" id="mInfo">Ver técnica</button>
      <button class="btn block" id="mHist">Ver progreso</button>
      <button class="btn block danger" id="mDel">Quitar del entreno</button>
    </div>`);
  const m = $("#modal");
  m.querySelectorAll("[data-rest]").forEach((b) => (b.onclick = () => { ex.rest = Number(b.dataset.rest); saveActive(); closeModal(); refreshExercise(ei); }));
  $("#mUp").onclick = () => { [A.exercises[ei - 1], A.exercises[ei]] = [A.exercises[ei], A.exercises[ei - 1]]; saveActive(); closeModal(); renderActive(); };
  $("#mDown").onclick = () => { [A.exercises[ei + 1], A.exercises[ei]] = [A.exercises[ei], A.exercises[ei + 1]]; saveActive(); closeModal(); renderActive(); };
  $("#mSwap").onclick = () => pickExercise((n) => { ex.exercise = n.id; ex.name = n.name; saveActive(); renderActive(); });
  $("#mHist").onclick = () => { closeModal(); go(`#/progreso/${ex.exercise}`); };
  $("#mInfo").onclick = () => exerciseInfo(ex.exercise);
  $("#mDel").onclick = () => { if (confirm("¿Quitar este ejercicio del entreno?")) { A.exercises.splice(ei, 1); saveActive(); closeModal(); renderActive(); } };
}

async function finishWorkout() {
  const A = S.active;
  const data = A.exercises
    .map((e) => ({
      exercise: e.exercise, name: exName(e.exercise, e.name), rest: e.rest, target: e.target,
      sets: e.sets.filter((s) => s.done).map((s) => ({ w: num(s.w) ?? 0, r: num(s.r) ?? 0, ...(num(s.rpe) ? { rpe: num(s.rpe) } : {}), done: true, ...(s._pr ? { pr: true } : {}) })),
    }))
    .filter((e) => e.sets.length);
  const pending = A.exercises.reduce((n, e) => n + e.sets.filter((s) => !s.done).length, 0);
  if (!data.length) {
    if (confirm("No has completado ninguna serie. ¿Descartar el entreno?")) { S.active = null; saveActive(); stopTimer(); go("#/"); }
    return;
  }
  if (pending && !confirm(`Hay ${pending} serie(s) sin marcar; no se guardarán. ¿Terminar igual?`)) return;

  const volume = data.reduce((v, e) => v + e.sets.reduce((a, s) => a + s.w * s.r, 0), 0);
  const prs = data.reduce((n, e) => n + e.sets.filter((s) => s.pr).length, 0);
  const rec = {
    user: pb.authStore.record.id,
    name: A.name.trim() || "Entreno",
    routine: A.routine,
    started: pbDate(A.started),
    ended: pbDate(new Date()),
    notes: A.notes,
    data, volume, client_id: A.client_id,
  };
  // guardar primero en la cola local: si no hay conexión no se pierde nada
  LS.set(key("queue"), [...LS.get(key("queue"), []), rec]);
  S.workouts = [{ ...rec, id: `local-${A.client_id}`, _pending: true }, ...S.workouts];
  S.active = null; saveActive(); stopTimer();
  await flushQueue(true);
  const saved = S.workouts.find((w) => w.client_id === rec.client_id);
  showSummary(saved || rec, prs);
}

function showSummary(w, prs) {
  const sets = (w.data || []).reduce((n, e) => n + e.sets.length, 0);
  openModal(`
    <div style="text-align:center;padding:12px 0 4px">
      <div style="font-size:44px">${prs ? "🏆" : "💪"}</div>
      <h2 style="font-size:22px;color:var(--text);text-transform:none;letter-spacing:0;margin:8px 0 4px">¡Entreno terminado!</h2>
      <div class="sub">${esc(w.name)}${w._pending ? " · se sincronizará cuando haya conexión" : ""}</div>
    </div>
    <div class="stats">
      <div class="stat"><b>${duration(w.started, w.ended)}</b><span>duración</span></div>
      <div class="stat"><b class="num">${fmt(w.volume, 0)}</b><span>volumen (${unit()})</span></div>
      <div class="stat"><b>${sets}</b><span>series</span></div>
    </div>
    ${prs ? `<p style="text-align:center;color:var(--gold);font-weight:600">${prs} récord${prs > 1 ? "s" : ""} personal${prs > 1 ? "es" : ""} nuevo${prs > 1 ? "s" : ""}</p>` : ""}
    <div class="stack" style="margin-top:16px">
      ${!w.routine ? `<button class="btn block" id="saveAsRoutine">Guardar como rutina</button>` : ""}
      <button class="btn primary block" data-close>Listo</button>
    </div>`);
  $("#saveAsRoutine")?.addEventListener("click", async () => {
    try {
      const r = await pb.collection("routines").create({
        user: pb.authStore.record.id, name: w.name,
        items: (w.data || []).map((e) => ({ exercise: e.exercise, sets: e.sets.length, reps: "", rest: e.rest || defaultRest() })),
      });
      S.routines = [r, ...S.routines]; cacheData();
      toast("Rutina guardada"); closeModal(); go("#/");
    } catch { toast("No se pudo guardar (¿sin conexión?)"); }
  });
  $("#modal").addEventListener("modalclose", () => go("#/"), { once: true });
}

// ------------------------------ avisos push ------------------------------
// El temporizador corre en el teléfono, pero si la pantalla se bloquea el navegador
// se duerme. Por eso la Pi manda una notificación push al terminar el descanso.
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const pushOn = () => pushSupported() && Notification.permission === "granted" && LS.get(key("push"), false);

function nextLabel() {
  // el siguiente ejercicio con series pendientes
  const ex = S.active?.exercises.find((e) => e.sets.some((s) => !s.done));
  return ex ? exName(ex.exercise, ex.name) : "";
}

const b64ToBytes = (b64) => {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function enablePush() {
  if (!pushSupported()) {
    if (isIOS && !isStandalone()) throw new Error("En iPhone primero instala la app: Compartir → Agregar a pantalla de inicio, y ábrela desde el ícono.");
    throw new Error("Este navegador no soporta notificaciones.");
  }
  // iOS exige pedir el permiso directamente en el toque, antes de cualquier otra espera
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Permiso denegado. Actívalo en Ajustes → Notificaciones → Hierro.");
  const cfg = await (await fetch("/api/gym/push-key")).json();
  if (!cfg.enabled) throw new Error("El servidor no tiene las notificaciones activadas.");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.publicKey) });
  const json = sub.toJSON();
  const me = pb.authStore.record.id;
  try {
    const old = await pb.collection("push_subs").getFirstListItem(pb.filter("endpoint = {:e}", { e: json.endpoint }));
    await pb.collection("push_subs").update(old.id, { sub: json });
  } catch {
    await pb.collection("push_subs").create({ user: me, endpoint: json.endpoint, sub: json, device: navigator.userAgent.slice(0, 200) });
  }
  LS.set(key("push"), true);
}

async function disablePush() {
  LS.set(key("push"), false);
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      try {
        const rec = await pb.collection("push_subs").getFirstListItem(pb.filter("endpoint = {:e}", { e: sub.endpoint }));
        await pb.collection("push_subs").delete(rec.id);
      } catch {}
      await sub.unsubscribe();
    }
  } catch {}
}

function schedulePush(at, label) {
  if (!pushOn() || !navigator.onLine) return;
  pb.send("/api/gym/rest", { method: "POST", body: { at, label } }).catch(() => {});
}
function cancelPush() {
  if (!pushOn() || !navigator.onLine) return;
  pb.send("/api/gym/rest/cancel", { method: "POST" }).catch(() => {});
}

// ------------------------------ temporizador ------------------------------
let timerInt, timerState = null;
function startTimer(sec, label) {
  timerState = { end: Date.now() + sec * 1000, total: sec, label };
  LS.set(key("timer"), timerState);
  schedulePush(timerState.end, nextLabel());
  drawTimer();
  clearInterval(timerInt); timerInt = setInterval(drawTimer, 250);
}
function stopTimer() {
  if (timerState && timerState.end > Date.now()) cancelPush();
  clearInterval(timerInt); timerState = null; LS.del(key("timer")); $("#timer").hidden = true;
}
function drawTimer() {
  const el = $("#timer");
  if (!timerState) return (el.hidden = true);
  const left = (timerState.end - Date.now()) / 1000;
  if (left <= 0) {
    el.classList.add("ring");
    el.innerHTML = `<div class="t">¡A darle!<small>Descanso terminado</small></div><button class="btn sm" id="tClose">Cerrar</button>`;
    $("#tClose").onclick = stopTimer;
    clearInterval(timerInt);
    beep(); buzz([300, 120, 300]);
    setTimeout(() => { if (timerState && timerState.end <= Date.now()) stopTimer(); }, 8000);
    return;
  }
  el.classList.remove("ring");
  el.hidden = false;
  const pct = 100 * (1 - left / timerState.total);
  if (!el.querySelector(".t")?.dataset.live) {
    el.innerHTML = `<div class="bar"></div>
      <div class="t" data-live="1"><span class="tv"></span><small>Descanso · ${esc(timerState.label || "")}</small></div>
      <button class="btn sm" data-d="-15">−15</button><button class="btn sm" data-d="15">+15</button><button class="btn sm primary" data-d="skip">Saltar</button>`;
    el.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => {
      if (b.dataset.d === "skip") return stopTimer();
      timerState.end += Number(b.dataset.d) * 1000;
      timerState.total = Math.max(5, timerState.total + Number(b.dataset.d));
      LS.set(key("timer"), timerState); drawTimer();
      schedulePush(timerState.end, nextLabel());
    }));
  }
  el.querySelector(".tv").textContent = mmss(left);
  el.querySelector(".bar").style.width = `${pct}%`;
}

// ------------------------------ selector de ejercicios ------------------------------
function pickExercise(onPick) {
  let muscle = "", q = "";
  const counts = new Map();
  for (const w of S.workouts) for (const e of w.data || []) counts.set(e.exercise, (counts.get(e.exercise) || 0) + 1);

  openModal(`
    <div class="sheet-head"><h2>Elegir ejercicio</h2><button class="icon-btn" data-close>✕</button></div>
    <input class="in" id="exQ" placeholder="Buscar…" autocomplete="off">
    <div class="chips" style="margin:10px 0" id="exM">
      <button class="chip on" data-m="">Todos</button>
      ${Object.entries(MUSCLES).map(([k, v]) => `<button class="chip" data-m="${k}">${v}</button>`).join("")}
    </div>
    <div id="exRes"></div>
    <button class="btn block" style="margin-top:14px" id="exNew">+ Crear ejercicio nuevo</button>
  `);
  const draw = () => {
    const norm = (s) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    const nq = norm(q);
    const list = S.exercises
      .filter((e) => (!muscle || e.muscle === muscle) && (!nq || norm(e.name).includes(nq)))
      .sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0) || a.name.localeCompare(b.name, "es"));
    $("#exRes").innerHTML = list.length ? list.map((e) => `
      <div class="pick" data-id="${e.id}">
        ${thumb(e.id)}
        <div class="grow"><div>${esc(e.name)}</div><div class="sub">${MUSCLES[e.muscle] || ""}${e.equipment ? ` · ${esc(e.equipment)}` : ""}${e.user ? " · propio" : ""}</div></div>
        ${counts.get(e.id) ? `<span class="chip">${counts.get(e.id)}×</span>` : ""}
      </div>`).join("") : `<div class="empty">Sin resultados. Créalo abajo.</div>`;
  };
  draw();
  $("#exQ").oninput = (e) => { q = e.target.value; draw(); };
  $("#exM").onclick = (e) => {
    const b = e.target.closest("[data-m]"); if (!b) return;
    muscle = b.dataset.m;
    $("#exM").querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === b));
    draw();
  };
  $("#exRes").onclick = (e) => {
    const p = e.target.closest("[data-id]"); if (!p) return;
    closeModal(); onPick(S.exMap.get(p.dataset.id));
  };
  $("#exNew").onclick = () => createExerciseModal(q, onPick);
}

function createExerciseModal(name, onPick) {
  openModal(`
    <div class="sheet-head"><h2>Nuevo ejercicio</h2><button class="icon-btn" data-close>✕</button></div>
    <form id="newEx">
      <label class="f">Nombre</label><input class="in" name="name" value="${esc(name)}" required maxlength="80">
      <label class="f">Grupo muscular</label>
      <select class="in" name="muscle">${Object.entries(MUSCLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
      <label class="f">Equipo (opcional)</label><input class="in" name="equipment" placeholder="barra, mancuernas, máquina…" maxlength="40">
      <div class="err" id="newExErr"></div>
      <button class="btn primary block" style="margin-top:8px">Crear</button>
    </form>`);
  $("#newEx").onsubmit = async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    try {
      const rec = await pb.collection("exercises").create({ ...f, user: pb.authStore.record.id });
      setExercises([...S.exercises, rec]); cacheData();
      closeModal(); onPick(rec);
    } catch { $("#newExErr").textContent = "No se pudo crear. ¿Hay conexión?"; }
  };
}

// ------------------------------ técnica ------------------------------
let infoInt;
function exerciseInfo(id) {
  const ex = S.exMap.get(id);
  if (!ex) return;
  const frames = Math.max(1, ex.frames || (ex.media ? 2 : 0));
  const steps = Array.isArray(ex.instructions) ? ex.instructions : [];
  openModal(`
    <div class="sheet-head"><h2>${esc(ex.name)}</h2><button class="icon-btn" data-close>✕</button></div>
    ${ex.media ? `
      <div class="demo" id="demo">${Array.from({ length: frames }, (_, i) => `<img src="${exImg(id, i)}" alt="" class="${i ? "" : "on"}">`).join("")}
        ${frames > 1 ? `<span class="demo-tag" id="demoTag">Inicio</span>` : ""}</div>
    ` : `<div class="empty">Este ejercicio aún no tiene imagen.</div>`}
    <div class="chips" style="margin:12px 0">
      ${ex.muscle ? `<span class="chip">${MUSCLES[ex.muscle] || ex.muscle}</span>` : ""}
      ${ex.equipment ? `<span class="chip">${esc(ex.equipment)}</span>` : ""}
    </div>
    ${steps.length ? `<h2 style="margin-top:8px">Instrucciones <span style="text-transform:none;letter-spacing:0">(en inglés)</span></h2>
      <ol class="steps">${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
    ${ex.media ? `<p class="sub" style="font-size:12px;margin-top:16px">Imágenes: free-exercise-db (dominio público)</p>` : ""}
  `);
  clearInterval(infoInt);
  if (frames > 1) {
    let f = 0;
    infoInt = setInterval(() => {
      const d = $("#demo"); if (!d) return clearInterval(infoInt);
      f = (f + 1) % frames;
      d.querySelectorAll("img").forEach((im, i) => im.classList.toggle("on", i === f));
      $("#demoTag").textContent = f ? "Final" : "Inicio";
    }, 1200);
  }
}

// ------------------------------ rutinas ------------------------------
function renderRoutines() {
  view.innerHTML = `
    <div class="top"><h1>Rutinas</h1><a class="btn sm primary" href="#/rutina/nueva">+ Nueva</a></div>
    ${S.routines.length ? S.routines.map((r) => `
      <div class="card tap" data-r="${r.id}">
        <div class="list-item"><h3>${esc(r.name)}</h3><span class="sub">${(r.items || []).length} ejercicios</span></div>
        <div class="sub" style="margin-top:6px">${(r.items || []).map((i) => `${esc(exName(i.exercise))} <span class="num">${i.sets}×${esc(i.reps || "?")}</span>`).join("<br>")}</div>
        <div class="row" style="margin-top:12px"><button class="btn sm primary" data-start="${r.id}">Empezar</button><button class="btn sm ghost" data-edit="${r.id}">Editar</button></div>
      </div>`).join("") : `<div class="empty">Crea plantillas como “Pierna”, “Push” o “Full body” para empezar un entreno con un toque.</div>`}
  `;
  view.querySelectorAll("[data-start]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); startWorkout(S.routines.find((r) => r.id === b.dataset.start)); }));
  view.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); go(`#/rutina/${b.dataset.edit}`); }));
  view.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => go(`#/rutina/${b.dataset.r}`)));
}

function renderRoutineEdit(id) {
  const existing = S.routines.find((r) => r.id === id);
  if (id !== "nueva" && !existing) return go("#/rutinas");
  const R = existing ? JSON.parse(JSON.stringify(existing)) : { name: "", items: [], notes: "" };
  R.items ||= [];

  const draw = () => {
    view.innerHTML = `
      <div class="top"><button class="back" onclick="history.back()">‹</button><h1>${existing ? "Editar rutina" : "Nueva rutina"}</h1></div>
      <label class="f">Nombre</label>
      <input class="in" id="rName" value="${esc(R.name)}" placeholder="Ej. Pierna, Push, Torso A…" maxlength="80">
      <h2>Ejercicios</h2>
      <div id="rItems">
        ${R.items.map((it, i) => `
          <div class="card">
            <div class="row">${thumb(it.exercise)}<h3 class="grow" style="margin:0">${esc(exName(it.exercise))}</h3>
              <button class="icon-btn" data-up="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
              <button class="icon-btn" data-down="${i}" ${i === R.items.length - 1 ? "disabled" : ""}>↓</button>
              <button class="icon-btn" data-del="${i}">✕</button></div>
            <div class="row" style="margin-top:10px">
              <div class="grow"><label class="f" style="margin-top:0">Series</label><input class="in" inputmode="numeric" data-i="${i}" data-k="sets" value="${it.sets}"></div>
              <div class="grow"><label class="f" style="margin-top:0">Reps</label><input class="in" data-i="${i}" data-k="reps" value="${esc(it.reps)}" placeholder="8-12"></div>
              <div class="grow"><label class="f" style="margin-top:0">Descanso (s)</label><input class="in" inputmode="numeric" data-i="${i}" data-k="rest" value="${it.rest}"></div>
            </div>
          </div>`).join("") || `<div class="empty">Sin ejercicios todavía.</div>`}
      </div>
      <button class="btn block" style="margin-top:12px" id="rAdd">+ Añadir ejercicio</button>
      <button class="btn primary block" style="margin-top:12px" id="rSave">Guardar rutina</button>
      ${existing ? `<button class="btn ghost danger block" style="margin-top:12px" id="rDel">Eliminar rutina</button>` : ""}
    `;
    $("#rName").oninput = (e) => (R.name = e.target.value);
    $("#rItems").oninput = (e) => {
      const t = e.target; if (!t.dataset.k) return;
      const it = R.items[Number(t.dataset.i)];
      it[t.dataset.k] = t.dataset.k === "reps" ? t.value : (parseInt(t.value) || 0);
    };
    $("#rItems").onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.up) { const i = +b.dataset.up; [R.items[i - 1], R.items[i]] = [R.items[i], R.items[i - 1]]; }
      if (b.dataset.down) { const i = +b.dataset.down; [R.items[i + 1], R.items[i]] = [R.items[i], R.items[i + 1]]; }
      if (b.dataset.del) R.items.splice(+b.dataset.del, 1);
      draw();
    };
    $("#rAdd").onclick = () => pickExercise((ex) => { R.items.push({ exercise: ex.id, sets: 3, reps: "8-12", rest: defaultRest() }); draw(); });
    $("#rSave").onclick = async () => {
      if (!R.name.trim()) return toast("Ponle nombre a la rutina");
      const body = { user: pb.authStore.record.id, name: R.name.trim(), items: R.items.map((i) => ({ ...i, sets: Math.max(1, i.sets || 1) })), notes: R.notes || "" };
      try {
        const rec = existing ? await pb.collection("routines").update(existing.id, body) : await pb.collection("routines").create(body);
        S.routines = [rec, ...S.routines.filter((r) => r.id !== rec.id)]; cacheData();
        toast("Rutina guardada"); go("#/rutinas");
      } catch { toast("No se pudo guardar (¿sin conexión?)"); }
    };
    $("#rDel")?.addEventListener("click", async () => {
      if (!confirm("¿Eliminar esta rutina? Tus entrenos pasados no se borran.")) return;
      try { await pb.collection("routines").delete(existing.id); S.routines = S.routines.filter((r) => r.id !== existing.id); cacheData(); go("#/rutinas"); }
      catch { toast("No se pudo eliminar"); }
    });
  };
  draw();
}

// ------------------------------ historial ------------------------------
function workoutCard(w) {
  const sets = (w.data || []).reduce((n, e) => n + e.sets.length, 0);
  const prs = (w.data || []).reduce((n, e) => n + e.sets.filter((s) => s.pr).length, 0);
  return `
    <div class="card tap" data-wk="${w.id}">
      <div class="list-item"><h3>${esc(w.name)}</h3><span class="sub">${fmtDate(w.started)}</span></div>
      <div class="sub">${(w.data || []).map((e) => `${e.sets.length}× ${esc(exName(e.exercise, e.name))}`).slice(0, 4).join(" · ")}${(w.data || []).length > 4 ? " …" : ""}</div>
      <div class="meta num">
        ${w.ended ? `<span>⏱ ${duration(w.started, w.ended)}</span>` : ""}
        <span>${fmt(w.volume, 0)} ${unit()}</span><span>${sets} series</span>
        ${prs ? `<span style="color:var(--gold)">🏆 ${prs}</span>` : ""}
        ${w._pending ? `<span style="color:var(--gold)">pendiente de sincronizar</span>` : ""}
      </div>
    </div>`;
}

function renderHistory() {
  const groups = new Map();
  for (const w of S.workouts) {
    const k = fmtDate(w.started, { month: "long", year: "numeric" });
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(w);
  }
  view.innerHTML = `
    <div class="top"><h1>Historial</h1></div>
    ${S.workouts.length ? [...groups].map(([k, list]) => `<h2>${esc(k)} · ${list.length}</h2>${list.map(workoutCard).join("")}`).join("")
      : `<div class="empty">Aquí aparecerán tus entrenos terminados.</div>`}
  `;
  view.querySelectorAll("[data-wk]").forEach((b) => (b.onclick = () => go(`#/entreno/${b.dataset.wk}`)));
}

function renderWorkoutDetail(id) {
  const w = S.workouts.find((x) => x.id === id);
  if (!w) return go("#/historial");
  const u = unit();
  view.innerHTML = `
    <div class="top"><button class="back" onclick="history.back()">‹</button><h1>${esc(w.name)}</h1></div>
    <div class="sub">${fmtDate(w.started, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${parseDate(w.started).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</div>
    <div class="stats">
      <div class="stat"><b>${w.ended ? duration(w.started, w.ended) : "–"}</b><span>duración</span></div>
      <div class="stat"><b class="num">${fmt(w.volume, 0)}</b><span>volumen (${u})</span></div>
      <div class="stat"><b>${(w.data || []).reduce((n, e) => n + e.sets.length, 0)}</b><span>series</span></div>
    </div>
    ${(w.data || []).map((e) => `
      <div class="card" style="margin-top:12px">
        <div class="list-item"><h3><a href="#/progreso/${e.exercise}">${esc(exName(e.exercise, e.name))}</a></h3></div>
        ${e.sets.map((s, i) => `<div class="detail-set"><span class="n">${i + 1}</span><span class="grow">${fmt(s.w)} ${u} × ${s.r}${s.rpe ? ` @${s.rpe}` : ""}</span><span class="sub">1RM ${fmt(e1rm(s.w, s.r))}</span>${s.pr ? `<span class="pr-badge">🏆</span>` : ""}</div>`).join("")}
      </div>`).join("")}
    ${w.notes ? `<h2>Notas</h2><div class="card" style="white-space:pre-wrap">${esc(w.notes)}</div>` : ""}
    <div class="stack" style="margin-top:18px">
      <button class="btn primary block" id="again">Repetir este entreno</button>
      ${w._pending ? "" : `<button class="btn ghost danger block" id="del">Eliminar entreno</button>`}
    </div>`;
  $("#again").onclick = () => startWorkout(null, w);
  $("#del")?.addEventListener("click", async () => {
    if (!confirm("¿Eliminar este entreno del historial?")) return;
    try { await pb.collection("workouts").delete(w.id); S.workouts = S.workouts.filter((x) => x.id !== w.id); cacheData(); go("#/historial"); }
    catch { toast("No se pudo eliminar"); }
  });
}

// ------------------------------ progreso ------------------------------
function renderProgress() {
  const seen = new Map();
  for (const w of S.workouts) for (const e of w.data || []) {
    const s = seen.get(e.exercise) || { n: 0, last: w.started };
    s.n++; seen.set(e.exercise, s);
  }
  const list = [...seen].map(([id, s]) => {
    const h = exerciseHistory(id);
    return { id, n: s.n, last: s.last, best: Math.max(0, ...h.map((x) => x.best1)), trend: h.length >= 2 ? h[0].best1 - h[h.length - 1].best1 : 0 };
  }).sort((a, b) => b.n - a.n);
  const u = unit();
  // volumen semanal de las últimas 8 semanas
  const weeks = [];
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  for (let i = 7; i >= 0; i--) {
    const a = new Date(start); a.setDate(a.getDate() - 7 * i);
    const b = new Date(a); b.setDate(b.getDate() + 7);
    const ws = S.workouts.filter((w) => { const d = parseDate(w.started); return d >= a && d < b; });
    weeks.push({ label: a.toLocaleDateString("es", { day: "numeric", month: "short" }), v: ws.reduce((x, w) => x + (w.volume || 0), 0), n: ws.length });
  }
  view.innerHTML = `
    <div class="top"><h1>Progreso</h1></div>
    <h2>Volumen semanal (${u})</h2>
    <div class="card">${barChart(weeks)}</div>
    <h2>Por ejercicio</h2>
    ${list.length ? list.map((x) => `
      <div class="card tap list-item" data-ex="${x.id}">
        <div><h3>${esc(exName(x.id))}</h3><div class="sub">${x.n} ${x.n === 1 ? "sesión" : "sesiones"} · última ${fmtDate(x.last)}</div></div>
        <div style="text-align:right"><b class="num">${fmt(x.best)}</b><div class="sub">1RM est. ${x.trend > 0 ? `<span style="color:var(--accent)">▲</span>` : x.trend < 0 ? "▼" : ""}</div></div>
      </div>`).join("") : `<div class="empty">Termina tu primer entreno para ver tu progreso.</div>`}
  `;
  view.querySelectorAll("[data-ex]").forEach((b) => (b.onclick = () => go(`#/progreso/${b.dataset.ex}`)));
}

function barChart(weeks) {
  const W = 340, H = 150, pad = 22, max = Math.max(1, ...weeks.map((w) => w.v));
  const bw = (W - 8) / weeks.length;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Volumen semanal">
    <line class="grid" x1="0" x2="${W}" y1="${H - pad}" y2="${H - pad}"/>
    ${weeks.map((w, i) => {
      const h = ((H - pad - 18) * w.v) / max;
      const x = 4 + i * bw + bw * 0.18;
      return `<rect x="${x}" y="${H - pad - h}" width="${bw * 0.64}" height="${Math.max(h, w.v ? 2 : 0)}" rx="4" fill="var(--accent)" opacity="${i === weeks.length - 1 ? 1 : 0.55}"/>
        ${w.v ? `<text x="${x + bw * 0.32}" y="${H - pad - h - 5}" text-anchor="middle">${w.v >= 1000 ? fmt(w.v / 1000) + "k" : fmt(w.v, 0)}</text>` : ""}
        <text x="${x + bw * 0.32}" y="${H - 6}" text-anchor="middle">${esc(w.label)}</text>`;
    }).join("")}
  </svg>`;
}

function lineChart(points, label) {
  if (points.length < 2) return `<div class="empty" style="padding:16px">Necesitas al menos 2 sesiones para ver la gráfica.</div>`;
  const W = 340, H = 170, pl = 34, pr = 10, pt = 12, pb_ = 24;
  const ys = points.map((p) => p.y), min = Math.min(...ys), max = Math.max(...ys);
  const lo = Math.floor(min - (max - min) * 0.1 - 1), hi = Math.ceil(max + (max - min) * 0.1 + 1);
  const t0 = points[0].x, t1 = points[points.length - 1].x || t0 + 1;
  const X = (x) => pl + ((x - t0) / Math.max(1, t1 - t0)) * (W - pl - pr);
  const Y = (y) => pt + (1 - (y - lo) / Math.max(1, hi - lo)) * (H - pt - pb_);
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
  const ticks = [lo, (lo + hi) / 2, hi];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    ${ticks.map((t) => `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${pl - 6}" y="${Y(t) + 4}" text-anchor="end">${fmt(t, 0)}</text>`).join("")}
    <path class="area" d="${d}L${X(points[points.length - 1].x)},${H - pb_}L${X(points[0].x)},${H - pb_}Z"/>
    <path class="ln" d="${d}"/>
    ${points.map((p) => `<circle class="dot" cx="${X(p.x)}" cy="${Y(p.y)}" r="3"/>`).join("")}
    <text x="${pl}" y="${H - 6}">${new Date(t0).toLocaleDateString("es", { day: "numeric", month: "short" })}</text>
    <text x="${W - pr}" y="${H - 6}" text-anchor="end">${new Date(t1).toLocaleDateString("es", { day: "numeric", month: "short" })}</text>
  </svg>`;
}

function renderExerciseProgress(id) {
  const ex = S.exMap.get(id);
  const h = exerciseHistory(id);
  const u = unit();
  const chrono = [...h].reverse();
  let metric = LS.get("hierro.metric", "best1");
  const bestW = Math.max(0, ...h.map((x) => x.bestW));
  const best1 = Math.max(0, ...h.map((x) => x.best1));
  const bestVol = Math.max(0, ...h.map((x) => x.vol));
  const maxReps = Math.max(0, ...h.flatMap((x) => x.sets.map((s) => num(s.r) || 0)));

  const draw = () => {
    const pts = chrono.map((x) => ({ x: parseDate(x.date).getTime(), y: x[metric] }));
    view.innerHTML = `
      <div class="top"><button class="back" onclick="history.back()">‹</button><h1>${esc(ex?.name || "Ejercicio")}</h1></div>
      ${ex?.media ? `<button class="card tap ex-hero" id="exInfo">${thumb(id, "thumb lg")}<div><b>Ver técnica</b><div class="sub">Imágenes${(ex.instructions || []).length ? " e instrucciones" : ""}</div></div></button>` : ""}
      ${h.length ? `
      <div class="seg" id="metric">
        <button data-m="best1" class="${metric === "best1" ? "on" : ""}">1RM est.</button>
        <button data-m="bestW" class="${metric === "bestW" ? "on" : ""}">Peso máx.</button>
        <button data-m="vol" class="${metric === "vol" ? "on" : ""}">Volumen</button>
      </div>
      <div class="card" style="margin-top:12px">${lineChart(pts, ex?.name || "")}</div>
      <h2>Récords personales</h2>
      <div class="kv">
        <div class="stat"><b class="num">${fmt(best1)}</b><span>1RM estimado (${u})</span></div>
        <div class="stat"><b class="num">${fmt(bestW)}</b><span>peso máximo (${u})</span></div>
        <div class="stat"><b class="num">${fmt(bestVol, 0)}</b><span>volumen en una sesión</span></div>
        <div class="stat"><b class="num">${maxReps}</b><span>reps máximas</span></div>
      </div>
      <h2>Sesiones</h2>
      ${h.map((x) => `<div class="card tap" data-wk="${x.workout.id}">
        <div class="list-item"><h3 style="font-size:15px">${fmtDate(x.date)}</h3><span class="sub num">1RM ${fmt(x.best1)}</span></div>
        <div class="sub num">${x.sets.map((s) => `${fmt(num(s.w))}×${s.r}`).join(" · ")}</div></div>`).join("")}
      ` : `<div class="empty">Aún no has registrado este ejercicio.</div>`}
    `;
    $("#exInfo")?.addEventListener("click", () => exerciseInfo(id));
    $("#metric")?.addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (!b) return; metric = b.dataset.m; LS.set("hierro.metric", metric); draw(); });
    view.querySelectorAll("[data-wk]").forEach((b) => (b.onclick = () => go(`#/entreno/${b.dataset.wk}`)));
  };
  draw();
}

// ------------------------------ perfil ------------------------------
function renderProfile() {
  const me = pb.authStore.record || {};
  view.innerHTML = `
    <div class="top"><h1>Perfil</h1></div>
    <div class="card">
      <h3>${esc(me.name || "Sin nombre")}</h3><div class="sub">${esc(me.email || "")}</div>
    </div>
    <h2>Preferencias</h2>
    <div class="card">
      <div class="list-item"><span>Unidades</span>
        <div class="seg" id="unitSeg"><button data-u="kg" class="${unit() === "kg" ? "on" : ""}">kg</button><button data-u="lb" class="${unit() === "lb" ? "on" : ""}">lb</button></div></div>
      <label class="f">Descanso por defecto</label>
      <div class="chips" id="restSeg">${[60, 90, 120, 150, 180].map((s) => `<button class="chip ${defaultRest() === s ? "on" : ""}" data-r="${s}">${mmss(s)}</button>`).join("")}</div>
    </div>
    <h2>Aviso de descanso</h2>
    <div class="card">
      <div class="list-item"><div><b>Notificación al terminar</b><div class="sub" id="pushState"></div></div>
        <button class="btn sm" id="pushToggle"></button></div>
      <button class="btn sm ghost" id="pushTest" style="margin-top:10px" hidden>Probar en 5 segundos</button>
    </div>
    <h2>Herramientas</h2>
    <div class="stack">
      <button class="btn block" id="plates">Calculadora de discos</button>
      <button class="btn block" id="csv">Exportar mis entrenos (CSV)</button>
      <a class="btn block" href="#/progreso">Ver mi progreso</a>
    </div>
    <h2>Cuenta</h2>
    <button class="btn block danger" id="logout">Cerrar sesión</button>
    <p class="sub" style="text-align:center;margin-top:24px">Hierro · alojado en tu propia Pi</p>
  `;
  const savePref = async (data) => {
    try { await pb.collection("users").update(me.id, data); route(); }
    catch { toast("No se pudo guardar (¿sin conexión?)"); }
  };
  $("#unitSeg").onclick = (e) => { const b = e.target.closest("[data-u]"); if (b) savePref({ unit: b.dataset.u }); };
  $("#restSeg").onclick = (e) => { const b = e.target.closest("[data-r]"); if (b) savePref({ rest_seconds: Number(b.dataset.r) }); };
  const drawPush = () => {
    const on = pushOn();
    const st = !pushSupported() ? (isIOS && !isStandalone() ? "Instala la app en la pantalla de inicio para activarlo" : "No disponible en este navegador")
      : Notification.permission === "denied" ? "Bloqueado: actívalo en Ajustes → Notificaciones → Hierro"
      : on ? "Activado en este dispositivo" : "Desactivado";
    $("#pushState").textContent = st;
    const t = $("#pushToggle");
    t.textContent = on ? "Desactivar" : "Activar";
    t.className = `btn sm ${on ? "" : "primary"}`;
    t.disabled = !pushSupported() || Notification.permission === "denied";
    $("#pushTest").hidden = !on;
  };
  drawPush();
  $("#pushToggle").onclick = async () => {
    $("#pushToggle").disabled = true;
    try {
      if (pushOn()) { await disablePush(); toast("Avisos desactivados"); }
      else { await enablePush(); toast("🔔 Avisos activados"); }
    } catch (err) { toast(err.message || "No se pudo cambiar"); }
    drawPush();
  };
  $("#pushTest").onclick = async () => {
    try {
      await pb.send("/api/gym/rest", { method: "POST", body: { at: Date.now() + 5000, label: "prueba" } });
      toast("Bloquea el teléfono: el aviso llega en 5 s");
    } catch { toast("No se pudo enviar la prueba"); }
  };
  $("#plates").onclick = () => plateModal();
  $("#csv").onclick = exportCsv;
  $("#logout").onclick = () => { if (!S.active || confirm("Tienes un entreno en curso; quedará guardado en este dispositivo. ¿Salir?")) logout(); };
}

function exportCsv() {
  const rows = [["fecha", "entreno", "ejercicio", "serie", `peso_${unit()}`, "reps", "rpe", "1rm_estimado"]];
  for (const w of [...S.workouts].reverse()) for (const e of w.data || []) e.sets.forEach((s, i) =>
    rows.push([parseDate(w.started).toISOString().slice(0, 16).replace("T", " "), w.name, exName(e.exercise, e.name), i + 1, s.w, s.r, s.rpe || "", Math.round(e1rm(s.w, s.r) * 10) / 10]));
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  a.download = `hierro-entrenos-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ------------------------------ calculadora de discos ------------------------------
function plateModal() {
  const u = unit();
  let bar = LS.get(`hierro.bar.${u}`, u === "kg" ? 20 : 45);
  openModal(`
    <div class="sheet-head"><h2>Calculadora de discos</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="row">
      <div class="grow"><label class="f" style="margin-top:0">Peso total (${u})</label><input class="in" id="pTarget" inputmode="decimal" placeholder="${u === "kg" ? "100" : "225"}"></div>
      <div class="grow"><label class="f" style="margin-top:0">Barra (${u})</label><input class="in" id="pBar" inputmode="decimal" value="${bar}"></div>
    </div>
    <div class="plates" id="pViz"></div>
    <div id="pText" class="sub" style="text-align:center"></div>`);
  const calc = () => {
    const target = num($("#pTarget").value), b = num($("#pBar").value) || 0;
    LS.set(`hierro.bar.${u}`, b);
    if (!target) { $("#pViz").innerHTML = ""; $("#pText").textContent = "Escribe el peso que quieres levantar."; return; }
    let side = (target - b) / 2;
    if (side < 0) { $("#pViz").innerHTML = ""; $("#pText").textContent = "El peso es menor que la barra."; return; }
    const used = [];
    for (const p of PLATES[u]) while (side >= p - 1e-9) { used.push(p); side -= p; }
    const half = used.map((p) => `<div class="plate" style="height:${40 + p * (u === "kg" ? 3 : 1.6)}px;background:${PLATE_COLORS[p] || "#999"}">${p}</div>`);
    $("#pViz").innerHTML = `${[...half].reverse().join("")}<div class="bar"></div>${half.join("")}`;
    $("#pText").innerHTML = used.length ? `Por lado: <b class="num">${used.join(" + ")}</b>${side > 0.01 ? `<br>Faltan ${fmt(side * 2, 2)} ${u} que no se pueden cargar` : ""}` : "Solo la barra.";
  };
  $("#pTarget").oninput = calc; $("#pBar").oninput = calc; calc();
  setTimeout(() => $("#pTarget")?.focus(), 50);
}

// ------------------------------ modal ------------------------------
function openModal(html) {
  const m = $("#modal");
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  m.onclick = (e) => { if (e.target === m || e.target.closest("[data-close]")) closeModal(); };
}
function closeModal() {
  const m = $("#modal");
  if (m.hidden) return;
  m.hidden = true; m.innerHTML = "";
  m.dispatchEvent(new Event("modalclose"));
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

// ------------------------------ arranque ------------------------------
function setOnline() { $("#offline").hidden = navigator.onLine; if (navigator.onLine && pb.authStore.isValid) flushQueue(); }
window.addEventListener("online", setOnline);
window.addEventListener("offline", setOnline);

async function boot() {
  setOnline();
  try { S.config = await (await fetch("/api/gym/config")).json(); } catch {}
  if (pb.authStore.isValid) {
    try { await pb.collection("users").authRefresh(); }
    catch (e) { if (e?.status === 401 || e?.status === 404) pb.authStore.clear(); }
  }
  if (pb.authStore.isValid) {
    await loadAll();
    const t = LS.get(key("timer"));
    if (t && t.end > Date.now()) { timerState = t; timerInt = setInterval(drawTimer, 250); drawTimer(); }
  }
  route();
}
boot();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
