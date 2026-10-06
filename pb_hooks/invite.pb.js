/// <reference path="../pb_data/types.d.ts" />

// Registro con código de invitación.
// Si la variable de entorno INVITE_CODE está definida, solo se puede crear
// una cuenta enviando ese código. Si no está definida, el registro es libre.
onRecordCreateRequest((e) => {
  const code = $os.getenv("INVITE_CODE");
  if (code && !e.hasSuperuserAuth()) {
    const body = e.requestInfo().body || {};
    if (String(body.invite || "").trim() !== code) {
      throw new BadRequestError("Código de invitación inválido.");
    }
  }
  e.next();
}, "users");

// Endpoint público para que la app sepa si debe pedir el código.
routerAdd("GET", "/api/gym/config", (e) => {
  return e.json(200, { inviteRequired: !!$os.getenv("INVITE_CODE") });
});
