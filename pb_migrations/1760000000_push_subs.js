/// <reference path="../pb_data/types.d.ts" />

// Suscripciones de notificaciones push (una por dispositivo).
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const ownerOnly = "@request.auth.id != '' && user = @request.auth.id";
  const col = new Collection({
    type: "base",
    name: "push_subs",
    listRule: ownerOnly,
    viewRule: ownerOnly,
    createRule: ownerOnly,
    updateRule: ownerOnly,
    deleteRule: ownerOnly,
    fields: [
      { name: "user", type: "relation", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "endpoint", type: "text", required: true, max: 1000 },
      { name: "sub", type: "json", required: true, maxSize: 5000 },
      { name: "device", type: "text", max: 200 },
      { name: "created", type: "autodate", onCreate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_push_endpoint ON push_subs (endpoint)"],
  });
  app.save(col);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("push_subs"));
});
