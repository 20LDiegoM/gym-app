#!/bin/bash
# Arranque local para probar (macOS/Linux). Doble clic en macOS.
# Requiere el binario ./pocketbase de https://github.com/pocketbase/pocketbase/releases
cd "$(dirname "$0")"
xattr -d com.apple.quarantine ./pocketbase 2>/dev/null
IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
echo ""
echo "  Hierro está corriendo:"
echo "   • En esta computadora: http://localhost:8090"
[ -n "$IP" ] && echo "   • En tu celular:        http://$IP:8090   (misma red Wi-Fi)"
echo "   • Código de invitación: ${INVITE_CODE:-prueba}"
echo ""
INVITE_CODE=${INVITE_CODE:-prueba} ./pocketbase serve --http=0.0.0.0:8090
