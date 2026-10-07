# Hierro 🏋️ — registro de gym autohospedado

App web (instalable en el celular) para registrar entrenos, multiusuario, corriendo en tu Raspberry Pi con **PocketBase** (un solo binario, SQLite, login incluido).

## Qué hace

- **Registro rápido**: series con peso/reps y un ✓. Si dejas vacío, ✓ usa lo de la vez pasada.
- **"Anterior"**: cada serie muestra lo que hiciste la última vez.
- **Rutinas** (plantillas) y "Repetir este entreno".
- **Temporizador de descanso** automático al marcar una serie (±15 s, vibra y suena).
- **Récords personales**: aviso 🏆 al superar tu 1RM estimado.
- **Progreso**: gráfica por ejercicio (1RM est., peso máx., volumen) y volumen semanal.
- **Calculadora de discos**, kg/lb, exportar CSV.
- **Aviso de fin de descanso** con notificación push: suena y vibra aunque el teléfono esté bloqueado.
- **Funciona sin conexión**: el entreno en curso vive en el teléfono y se sincroniza al volver la red.
- **Registro con código de invitación** para que solo entren los tuyos.
- 162 ejercicios base en español (máquinas, poleas, Smith, barra, mancuernas, kettlebell, cardio), 155 con fotos e instrucciones, + ejercicios propios por usuario.

## Desplegar en la Pi

```bash
# 1. Clonar el repo en la Pi
ssh pi@TU_PI
git clone <URL_DEL_REPO> ~/hierro
cd ~/hierro

# 2. Elegir código de invitación y levantar
cp .env.example .env && nano .env   # pon tu código de invitación
docker compose up -d --build

# 3. Crear tu cuenta de administrador de PocketBase
docker exec hierro /pb/pocketbase superuser upsert tu@correo.com UNA_CLAVE_LARGA --dir=/pb/pb_data
```

La app queda en `http://127.0.0.1:8090` dentro de la Pi (puerto cambiable con `HIERRO_PORT` en `.env`).

## Cloudflare Tunnel

En el panel de Zero Trust → **Networks → Tunnels → tu túnel → Public Hostname → Add**:

| Campo | Valor |
|---|---|
| Subdomain | `gym` (por ejemplo) |
| Domain | `murcia-dev.com` |
| Service | `HTTP` → `localhost:8090` |

Si tu `cloudflared` corre **en Docker**, `localhost` no apunta a la Pi: descomenta el bloque `networks` del `docker-compose.yml` (con el nombre de la red de tu cloudflared) y usa `http://hierro:8090` como servicio.

Si usas `config.yml` en vez del panel:

```yaml
ingress:
  - hostname: gym.murcia-dev.com
    service: http://localhost:8090
  # ...tus otras reglas...
  - service: http_status:404
```

**Recomendado:** protege el panel de administración con Cloudflare Access (política sobre la ruta `gym.murcia-dev.com/_/*`). La app en sí ya tiene login.

## Instalar en el celular

Abre `https://gym.murcia-dev.com` → crea tu cuenta con el código → menú del navegador → **Agregar a pantalla de inicio**.

## Administración

- Panel PocketBase: `https://gym.murcia-dev.com/_/` (usuarios, datos, backups).
- Para cerrar el registro por completo: deja `INVITE_CODE` y además pon la regla *Create* de la colección `users` en vacío/bloqueada desde el panel.
- **Backups**: toda la data está en `./pb_data`. Copia esa carpeta, o activa backups automáticos en el panel (Settings → Backups).

## Notificaciones del descanso

El contenedor `push` (Node + web-push) manda la notificación cuando termina el descanso, porque con la pantalla bloqueada el navegador del teléfono se duerme y no puede sonar por sí solo.

- Las claves VAPID se generan solas la primera vez en `./push_data/`. Si se borran, cada usuario tiene que reactivar los avisos.
- En `.env`: `PUSH_SECRET` (secreto interno) y `VAPID_SUBJECT` (tu correo, `mailto:...`).
- **iPhone (iOS 16.4+)**: solo funciona con la app instalada en la pantalla de inicio y abierta desde el ícono. Luego en **Perfil → Aviso de descanso → Activar** (o en el aviso que sale al empezar un entreno).
- **Android**: funciona desde Chrome, instalada o no.
- Para probar: **Perfil → Probar en 5 segundos** y bloquea el teléfono.

## Catálogo de ejercicios

- **Globales** (los ve todo el mundo): vienen en `pb_migrations/`. Para añadir o corregir, entra al panel `/_/` → colección `exercises` y edita; deja el campo `user` vacío para que sea global.
- **Propios**: cada usuario los crea desde la app ("+ Crear ejercicio nuevo"); solo los ve él.
- Si alguien crea uno propio que debería ser de todos, en el panel basta con vaciarle el campo `user`.
- **Imágenes**: 155 ejercicios traen fotos de inicio/final e instrucciones (en inglés) de [free-exercise-db](https://github.com/yuhonas/free-exercise-db), dominio público. Están en `pb_public/ex/`. La correspondencia nombre → imagen está en `tools/fedb_map.py`; para cambiarla, edítala y corre `python3 tools/build_media.py /ruta/a/free-exercise-db`.

## Actualizar

```bash
cd ~/hierro && git pull && docker compose up -d --build
```

Las migraciones nuevas se aplican solas al arrancar.

## Desarrollo local (sin Docker)

Descarga el binario de PocketBase para tu sistema desde [releases](https://github.com/pocketbase/pocketbase/releases) (v0.40.4), ponlo en esta carpeta y ejecuta `./iniciar.command` (en macOS, doble clic). Abre http://localhost:8090; el código de invitación por defecto es `prueba`.

## Estructura

```
pb_migrations/   esquema (ejercicios, rutinas, entrenos) + ejercicios base
pb_hooks/        código de invitación, /api/gym/config y puente de notificaciones
push/            servicio de notificaciones push (Node, solo red interna)
pb_public/       la app (HTML/CSS/JS sin build, PWA)
Dockerfile       imagen multi-arquitectura (arm64, armv7, amd64)
```
