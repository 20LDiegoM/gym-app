"""Copia imágenes de free-exercise-db para el catálogo y genera la migración.

Uso:
  git clone --depth 1 https://github.com/yuhonas/free-exercise-db /tmp/fedb
  python3 tools/build_media.py /tmp/fedb
"""
import json, os, sys
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from fedb_map import MAP

src = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fedb"
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out_dir = os.path.join(root, "pb_public", "ex")
db = {e["id"]: e for e in json.load(open(os.path.join(src, "dist", "exercises.json")))}

media = {}
for name, fid in MAP.items():
    if not fid:
        continue
    e = db[fid]
    os.makedirs(os.path.join(out_dir, fid), exist_ok=True)
    count = 0
    for i, rel in enumerate(e["images"][:2]):
        dst = os.path.join(out_dir, fid, f"{i}.jpg")
        if not os.path.exists(dst):
            im = Image.open(os.path.join(src, "exercises", rel)).convert("RGB")
            im.thumbnail((560, 560))
            im.save(dst, "JPEG", quality=72, optimize=True, progressive=True)
        count += 1
    media[name] = {"media": fid, "frames": count, "instructions": e.get("instructions", [])}

js = f"""/// <reference path="../pb_data/types.d.ts" />

// Imágenes e instrucciones de free-exercise-db (dominio público, Unlicense):
// https://github.com/yuhonas/free-exercise-db
// Generado por tools/build_media.py — las imágenes viven en pb_public/ex/<media>/0.jpg y 1.jpg

const MEDIA = {json.dumps(media, ensure_ascii=False, indent=0)};

migrate((app) => {{
  const col = app.findCollectionByNameOrId("exercises");
  if (!col.fields.getByName("media")) col.fields.add(new TextField({{ name: "media", max: 120 }}));
  if (!col.fields.getByName("frames")) col.fields.add(new NumberField({{ name: "frames", min: 0, max: 4, onlyInt: true }}));
  if (!col.fields.getByName("instructions")) col.fields.add(new JSONField({{ name: "instructions", maxSize: 20000 }}));
  app.save(col);

  for (const r of app.findRecordsByFilter("exercises", "user = ''", "", 0, 0)) {{
    const m = MEDIA[r.getString("name")];
    if (!m) continue;
    r.set("media", m.media);
    r.set("frames", m.frames);
    r.set("instructions", m.instructions);
    app.save(r);
  }}
}}, (app) => {{
  const col = app.findCollectionByNameOrId("exercises");
  for (const f of ["media", "frames", "instructions"]) col.fields.removeByName(f);
  app.save(col);
}});
"""
open(os.path.join(root, "pb_migrations", "1759900000_exercise_media.js"), "w").write(js)
print(f"{len(media)} ejercicios con imagen")
