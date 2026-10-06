/// <reference path="../pb_data/types.d.ts" />

// Esquema inicial: ejercicios, rutinas y entrenos.
// Cada usuario solo ve y modifica lo suyo; los ejercicios sin usuario son globales.

const MUSCLES = ["pecho", "espalda", "piernas", "gluteos", "hombros", "biceps", "triceps", "core", "cardio", "otro"];

const SEED = [
  // pecho
  ["Press de banca (barra)", "pecho", "barra"],
  ["Press de banca (mancuernas)", "pecho", "mancuernas"],
  ["Press inclinado (barra)", "pecho", "barra"],
  ["Press inclinado (mancuernas)", "pecho", "mancuernas"],
  ["Aperturas con mancuernas", "pecho", "mancuernas"],
  ["Cruce de poleas", "pecho", "polea"],
  ["Press en máquina (pecho)", "pecho", "máquina"],
  ["Fondos (dips)", "pecho", "peso corporal"],
  ["Lagartijas", "pecho", "peso corporal"],
  // espalda
  ["Peso muerto", "espalda", "barra"],
  ["Dominadas", "espalda", "peso corporal"],
  ["Jalón al pecho", "espalda", "polea"],
  ["Remo con barra", "espalda", "barra"],
  ["Remo con mancuerna", "espalda", "mancuernas"],
  ["Remo sentado en polea", "espalda", "polea"],
  ["Remo en máquina", "espalda", "máquina"],
  ["Pullover en polea", "espalda", "polea"],
  ["Encogimientos (shrugs)", "espalda", "mancuernas"],
  // piernas
  ["Sentadilla (barra)", "piernas", "barra"],
  ["Sentadilla frontal", "piernas", "barra"],
  ["Sentadilla goblet", "piernas", "mancuernas"],
  ["Prensa de piernas", "piernas", "máquina"],
  ["Sentadilla búlgara", "piernas", "mancuernas"],
  ["Zancadas", "piernas", "mancuernas"],
  ["Extensión de cuádriceps", "piernas", "máquina"],
  ["Curl femoral acostado", "piernas", "máquina"],
  ["Curl femoral sentado", "piernas", "máquina"],
  ["Peso muerto rumano", "piernas", "barra"],
  ["Elevación de pantorrillas", "piernas", "máquina"],
  // glúteos
  ["Hip thrust", "gluteos", "barra"],
  ["Patada de glúteo en polea", "gluteos", "polea"],
  ["Abducción en máquina", "gluteos", "máquina"],
  // hombros
  ["Press militar (barra)", "hombros", "barra"],
  ["Press de hombro (mancuernas)", "hombros", "mancuernas"],
  ["Elevaciones laterales", "hombros", "mancuernas"],
  ["Elevaciones laterales en polea", "hombros", "polea"],
  ["Pájaros (deltoide posterior)", "hombros", "mancuernas"],
  ["Face pull", "hombros", "polea"],
  // bíceps
  ["Curl con barra", "biceps", "barra"],
  ["Curl con mancuernas", "biceps", "mancuernas"],
  ["Curl martillo", "biceps", "mancuernas"],
  ["Curl en polea", "biceps", "polea"],
  ["Curl predicador", "biceps", "máquina"],
  // tríceps
  ["Extensión de tríceps en polea", "triceps", "polea"],
  ["Press francés", "triceps", "barra"],
  ["Extensión sobre la cabeza", "triceps", "mancuernas"],
  ["Press cerrado", "triceps", "barra"],
  // core
  ["Plancha", "core", "peso corporal"],
  ["Crunch en polea", "core", "polea"],
  ["Elevación de piernas colgado", "core", "peso corporal"],
  ["Rueda abdominal", "core", "otro"],
  // cardio
  ["Caminadora", "cardio", "máquina"],
  ["Bicicleta estática", "cardio", "máquina"],
  ["Remo (ergómetro)", "cardio", "máquina"],
];

migrate((app) => {
  const ownerOnly = "@request.auth.id != '' && user = @request.auth.id";

  // --- preferencias en usuarios ---
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new SelectField({ name: "unit", values: ["kg", "lb"], maxSelect: 1 }));
  users.fields.add(new NumberField({ name: "rest_seconds", min: 0, max: 900, onlyInt: true }));
  app.save(users);

  // --- ejercicios ---
  const exercises = new Collection({
    type: "base",
    name: "exercises",
    listRule: "@request.auth.id != '' && (user = '' || user = @request.auth.id)",
    viewRule: "@request.auth.id != '' && (user = '' || user = @request.auth.id)",
    createRule: ownerOnly,
    updateRule: ownerOnly,
    deleteRule: ownerOnly,
    fields: [
      { name: "name", type: "text", required: true, max: 80 },
      { name: "muscle", type: "select", values: MUSCLES, maxSelect: 1 },
      { name: "equipment", type: "text", max: 40 },
      { name: "user", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      { name: "created", type: "autodate", onCreate: true },
    ],
    indexes: ["CREATE INDEX idx_exercises_user ON exercises (user)"],
  });
  app.save(exercises);

  // --- rutinas (plantillas) ---
  const routines = new Collection({
    type: "base",
    name: "routines",
    listRule: ownerOnly,
    viewRule: ownerOnly,
    createRule: ownerOnly,
    updateRule: ownerOnly,
    deleteRule: ownerOnly,
    fields: [
      { name: "user", type: "relation", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "name", type: "text", required: true, max: 80 },
      // [{ exercise: "<id>", sets: 3, reps: "8-12", rest: 90 }]
      { name: "items", type: "json", maxSize: 200000 },
      { name: "notes", type: "text", max: 1000 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
  });
  app.save(routines);

  // --- entrenos registrados ---
  const workouts = new Collection({
    type: "base",
    name: "workouts",
    listRule: ownerOnly,
    viewRule: ownerOnly,
    createRule: ownerOnly,
    updateRule: ownerOnly,
    deleteRule: ownerOnly,
    fields: [
      { name: "user", type: "relation", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "name", type: "text", max: 80 },
      { name: "routine", type: "text", max: 30 },
      { name: "started", type: "date", required: true },
      { name: "ended", type: "date" },
      { name: "notes", type: "text", max: 2000 },
      // [{ exercise: "<id>", name: "...", sets: [{ w: 60, r: 8, rpe: 8, done: true }] }]
      { name: "data", type: "json", maxSize: 1000000 },
      { name: "volume", type: "number" },
      // id generado en el cliente, evita duplicados al sincronizar offline
      { name: "client_id", type: "text", max: 40 },
      { name: "created", type: "autodate", onCreate: true },
    ],
    indexes: [
      "CREATE INDEX idx_workouts_user_started ON workouts (user, started)",
      "CREATE UNIQUE INDEX idx_workouts_client ON workouts (user, client_id) WHERE client_id != ''",
    ],
  });
  app.save(workouts);

  // --- ejercicios base ---
  for (const [name, muscle, equipment] of SEED) {
    const r = new Record(exercises);
    r.set("name", name);
    r.set("muscle", muscle);
    r.set("equipment", equipment);
    app.save(r);
  }
}, (app) => {
  for (const name of ["workouts", "routines", "exercises"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("unit");
  users.fields.removeByName("rest_seconds");
  app.save(users);
});
