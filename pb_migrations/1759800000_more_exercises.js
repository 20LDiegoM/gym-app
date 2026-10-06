/// <reference path="../pb_data/types.d.ts" />

// Amplía el catálogo global a los ejercicios más comunes de un gym equipado.
// Es idempotente: si un ejercicio global con el mismo nombre ya existe, no lo duplica.
// Para añadir más en el futuro: crea otra migración como esta, o usa el panel /_/
// (colección "exercises", dejando "user" vacío = visible para todos).

const MORE = [
  // ---------- pecho ----------
  ["Press de banca declinado (barra)", "pecho", "barra"],
  ["Press inclinado en máquina", "pecho", "máquina"],
  ["Press de banca en Smith", "pecho", "smith"],
  ["Press inclinado en Smith", "pecho", "smith"],
  ["Aperturas en máquina (pec deck)", "pecho", "máquina"],
  ["Aperturas inclinadas con mancuernas", "pecho", "mancuernas"],
  ["Cruce de poleas de abajo hacia arriba", "pecho", "polea"],
  ["Pullover con mancuerna", "pecho", "mancuernas"],
  ["Fondos asistidos en máquina", "pecho", "máquina"],
  ["Press de pecho en polea", "pecho", "polea"],

  // ---------- espalda ----------
  ["Dominadas asistidas en máquina", "espalda", "máquina"],
  ["Dominadas supinas (chin-ups)", "espalda", "peso corporal"],
  ["Jalón agarre estrecho", "espalda", "polea"],
  ["Jalón a una mano", "espalda", "polea"],
  ["Remo en T", "espalda", "barra"],
  ["Remo Pendlay", "espalda", "barra"],
  ["Remo con pecho apoyado", "espalda", "máquina"],
  ["Remo a una mano en polea", "espalda", "polea"],
  ["Remo invertido", "espalda", "peso corporal"],
  ["Hiperextensiones (lumbares)", "espalda", "máquina"],
  ["Buenos días", "espalda", "barra"],
  ["Peso muerto sumo", "espalda", "barra"],
  ["Peso muerto con barra hexagonal", "espalda", "barra"],
  ["Rack pull", "espalda", "barra"],
  ["Encogimientos con barra", "espalda", "barra"],
  ["Jalón con brazos rectos", "espalda", "polea"],

  // ---------- piernas ----------
  ["Sentadilla en Smith", "piernas", "smith"],
  ["Sentadilla hack", "piernas", "máquina"],
  ["Sentadilla péndulo", "piernas", "máquina"],
  ["Sentadilla sumo con mancuerna", "piernas", "mancuernas"],
  ["Zancadas caminando", "piernas", "mancuernas"],
  ["Zancadas con barra", "piernas", "barra"],
  ["Step-up al cajón", "piernas", "mancuernas"],
  ["Peso muerto rumano con mancuernas", "piernas", "mancuernas"],
  ["Peso muerto a una pierna", "piernas", "mancuernas"],
  ["Curl femoral de pie", "piernas", "máquina"],
  ["Curl nórdico", "piernas", "peso corporal"],
  ["Elevación de pantorrillas de pie", "piernas", "máquina"],
  ["Elevación de pantorrillas sentado", "piernas", "máquina"],
  ["Pantorrillas en prensa", "piernas", "máquina"],
  ["Aducción en máquina", "piernas", "máquina"],
  ["Extensión de cuádriceps a una pierna", "piernas", "máquina"],

  // ---------- glúteos ----------
  ["Hip thrust en máquina", "gluteos", "máquina"],
  ["Hip thrust en Smith", "gluteos", "smith"],
  ["Puente de glúteo", "gluteos", "barra"],
  ["Patada de glúteo en máquina", "gluteos", "máquina"],
  ["Pull-through en polea", "gluteos", "polea"],
  ["Hiperextensión para glúteo", "gluteos", "máquina"],
  ["Abducción en polea", "gluteos", "polea"],
  ["Kettlebell swing", "gluteos", "kettlebell"],

  // ---------- hombros ----------
  ["Press Arnold", "hombros", "mancuernas"],
  ["Press de hombro en máquina", "hombros", "máquina"],
  ["Press militar en Smith", "hombros", "smith"],
  ["Press militar sentado (barra)", "hombros", "barra"],
  ["Push press", "hombros", "barra"],
  ["Press landmine", "hombros", "barra"],
  ["Elevaciones frontales", "hombros", "mancuernas"],
  ["Elevaciones frontales con disco", "hombros", "disco"],
  ["Elevaciones laterales en máquina", "hombros", "máquina"],
  ["Pájaros en máquina (pec deck inverso)", "hombros", "máquina"],
  ["Pájaros en polea", "hombros", "polea"],
  ["Remo al mentón", "hombros", "barra"],

  // ---------- bíceps ----------
  ["Curl con barra Z", "biceps", "barra"],
  ["Curl inclinado con mancuernas", "biceps", "mancuernas"],
  ["Curl concentrado", "biceps", "mancuernas"],
  ["Curl bayesiano en polea", "biceps", "polea"],
  ["Curl martillo con cuerda", "biceps", "polea"],
  ["Curl predicador con mancuerna", "biceps", "mancuernas"],
  ["Curl en máquina", "biceps", "máquina"],
  ["Curl araña", "biceps", "mancuernas"],

  // ---------- tríceps ----------
  ["Extensión de tríceps con cuerda", "triceps", "polea"],
  ["Extensión tras nuca en polea", "triceps", "polea"],
  ["Extensión de tríceps a una mano en polea", "triceps", "polea"],
  ["Patada de tríceps", "triceps", "mancuernas"],
  ["Press francés con mancuernas", "triceps", "mancuernas"],
  ["Extensión de tríceps en máquina", "triceps", "máquina"],
  ["Fondos en banco", "triceps", "peso corporal"],
  ["Fondos en máquina", "triceps", "máquina"],

  // ---------- antebrazos ----------
  ["Curl de muñeca", "antebrazos", "barra"],
  ["Curl de muñeca inverso", "antebrazos", "barra"],
  ["Curl inverso", "antebrazos", "barra"],
  ["Paseo del granjero", "antebrazos", "mancuernas"],
  ["Colgarse de la barra (dead hang)", "antebrazos", "peso corporal"],

  // ---------- core ----------
  ["Crunch", "core", "peso corporal"],
  ["Crunch en máquina", "core", "máquina"],
  ["Crunch en banco declinado", "core", "peso corporal"],
  ["Elevación de piernas en paralelas", "core", "máquina"],
  ["Elevación de rodillas colgado", "core", "peso corporal"],
  ["Plancha lateral", "core", "peso corporal"],
  ["Pallof press", "core", "polea"],
  ["Leñador en polea", "core", "polea"],
  ["Russian twist", "core", "disco"],
  ["Bicho muerto (dead bug)", "core", "peso corporal"],
  ["Rotación de tronco en máquina", "core", "máquina"],

  // ---------- cardio / acondicionamiento ----------
  ["Elíptica", "cardio", "máquina"],
  ["Escaladora", "cardio", "máquina"],
  ["Bicicleta de aire (air bike)", "cardio", "máquina"],
  ["Ski erg", "cardio", "máquina"],
  ["Saltar la cuerda", "cardio", "otro"],
  ["Empuje de trineo", "cardio", "otro"],
  ["Cuerdas de batalla", "cardio", "otro"],
  ["Burpees", "cardio", "peso corporal"],
  ["Caminata inclinada", "cardio", "máquina"],

  // ---------- olímpicos / funcionales ----------
  ["Cargada de potencia (power clean)", "otro", "barra"],
  ["Thruster", "otro", "barra"],
  ["Wall ball", "otro", "otro"],
  ["Turkish get-up", "otro", "kettlebell"],
  ["Goblet squat con kettlebell", "piernas", "kettlebell"],
];

migrate((app) => {
  const exercises = app.findCollectionByNameOrId("exercises");

  // nuevo grupo muscular
  const muscle = exercises.fields.getByName("muscle");
  if (!muscle.values.includes("antebrazos")) {
    muscle.values = [...muscle.values.filter((v) => v !== "otro"), "antebrazos", "otro"];
    app.save(exercises);
  }

  const existing = new Set(
    app.findRecordsByFilter("exercises", "user = ''", "", 0, 0).map((r) => r.getString("name").toLowerCase())
  );
  for (const [name, m, equipment] of MORE) {
    if (existing.has(name.toLowerCase())) continue;
    const r = new Record(exercises);
    r.set("name", name);
    r.set("muscle", m);
    r.set("equipment", equipment);
    app.save(r);
  }
}, (app) => {
  const names = new Set(MORE.map(([n]) => n));
  for (const r of app.findRecordsByFilter("exercises", "user = ''", "", 0, 0)) {
    if (names.has(r.getString("name"))) app.delete(r);
  }
});
