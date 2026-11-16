# 📱 Coti Mobile — App Nativa en Expo (React Native)

Esta carpeta contiene la aplicación nativa de **Coti** para **iOS y Android** construida con **Expo (React Native)**, con el selector de rol (**👷 Dueño del Taller** vs **👤 Vista del Cliente**), **Coti el Hornero** y apertura directa de WhatsApp (`wa.me/`).

---

## 1. Probar en vivo en tu celular con Expo Go (Escaneando QR)

```bash
cd /Users/priscilagomez/Desktop/Coti/mobile
npm install
npx expo start
```

- Escaneá el código QR desde la app **Expo Go** en tu teléfono (iOS o Android).
- O presioná **`i`** en la terminal para abrirla en el Simulador de iPhone (Xcode), o **`a`** para el Emulador de Android.

---

## 2. Cómo buildear el instalador nativo para celular (`.apk` / `.ipa`)

El proyecto ya incluye [app.json](./app.json) (`com.coti.crm`) y [eas.json](./eas.json) preconfigurados:

### Opción A: Generar `.apk` instalable en Android en la nube (EAS Build)
```bash
cd /Users/priscilagomez/Desktop/Coti/mobile
npx eas-cli build -p android --profile preview
```
*(El perfil `preview` en `eas.json` está configurado con `"buildType": "apk"` para que te entregue un archivo `.apk` directo para instalar en cualquier teléfono Android).*

### Opción B: Compilar localmente en tu Mac (iOS / Android nativo)
```bash
cd /Users/priscilagomez/Desktop/Coti/mobile
npx expo run:ios
# o para Android:
npx expo run:android
```
