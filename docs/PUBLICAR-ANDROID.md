# Como gerar o APK do VÉU para celular Android

O APK é a "casca" do jogo. As partidas acontecem no servidor, por isso:
**primeiro o servidor precisa estar na internet**, depois você gera o APK apontando para ele.

O projeto já está preparado: manifesto de aplicativo, ícones, funcionamento como app instalado
(tela cheia e na horizontal), cache básico e suporte ao arquivo de vínculo do Android.

---

## Parte 1 — Colocar o servidor na internet (Render, plano gratuito)

1. **Crie uma conta no GitHub** (github.com) e um repositório novo, por exemplo `veu-jogo`.
2. **Envie os arquivos do projeto** para o repositório. Sem usar comandos:
   na página do repositório, clique em *Add file → Upload files* e arraste o **conteúdo** da pasta `veu`
   (as pastas `client`, `server`, `shared`, `docs`, `scripts`, `tests`, `typings-offline` e os arquivos
   `package.json`, `render.yaml`, `tsconfig.json` etc.). Não envie `node_modules` nem `dist`.
3. **Crie uma conta no Render** (render.com) entrando com o GitHub.
4. No painel do Render: **New → Blueprint**, escolha o repositório `veu-jogo` e confirme.
   O arquivo `render.yaml` já diz tudo ao Render: como instalar, compilar e iniciar.
5. Aguarde a compilação (alguns minutos). Ao final aparece um endereço como
   `https://veu-ecos-da-ruptura.onrender.com`.
6. **Teste no navegador do celular** abrindo esse endereço. Se o menu aparecer e ficar "online", está pronto.

Observações sobre o plano gratuito do Render:
- O servidor "dorme" depois de ~15 min sem uso; o primeiro acesso seguinte demora ~1 minuto para acordar.
- Os dados (contas, progresso) **se perdem quando o servidor reinicia**. Para guardar de verdade,
  use um plano pago com disco persistente (e defina `DATA_FILE` para a pasta do disco) ou o PostgreSQL.

Alternativas equivalentes: Railway, Fly.io ou qualquer VPS com Node.js 20+ e HTTPS.

---

## Parte 2 — Gerar o APK com o PWABuilder (sem programar)

1. Acesse **pwabuilder.com**, cole o endereço do seu servidor (ex.: `https://veu-ecos-da-ruptura.onrender.com`)
   e clique em *Start*. Ele deve reconhecer o manifesto, os ícones e o service worker.
2. Clique em **Package for stores → Android → Generate Package**.
   - *Package ID*: um nome único, ex.: `com.seunome.veu`
   - *App name*: `VÉU: Ecos da Ruptura` · *Short name*: `VÉU`
   - *Display mode*: `Fullscreen` · *Orientation*: `Landscape` (já vêm do manifesto)
   - *Signing key*: deixe "Create new" e **guarde o arquivo de chave e as senhas** que ele gerar —
     são necessários para publicar atualizações.
3. Baixe o `.zip`. Dentro há:
   - `*.apk` → para instalar direto no celular;
   - `*.aab` → para enviar à Google Play;
   - `assetlinks.json` → vínculo entre o app e o seu site.
4. **Remova a barra de endereço do app** (opcional, recomendado): copie o conteúdo de `assetlinks.json`,
   vá no Render → seu serviço → *Environment* → *Add Environment Variable*:
   - Key: `ANDROID_ASSETLINKS`
   - Value: o conteúdo copiado (tudo, numa linha só)

   Salve; o Render reinicia o servidor. O jogo passa a responder em `/.well-known/assetlinks.json`
   e o Android abre o app sem a barra do navegador.

### Instalar o APK no celular
1. Envie o `.apk` para o celular (WhatsApp para você mesmo, Google Drive, cabo USB…).
2. Toque no arquivo. O Android pedirá para **permitir a instalação de fontes desconhecidas** para o app
   que você usou para abrir (Arquivos, Drive…). Permita e instale.
3. Abra o **VÉU**. Ele entra em tela cheia, na horizontal, com controles de toque.

### Publicar na Google Play (opcional)
Crie uma conta de desenvolvedor no Google Play Console (taxa única de US$ 25), crie o app e envie o `.aab`.
O Google exige política de privacidade, classificação indicativa e capturas de tela
(há capturas em `docs/capturas`).

---

## Alternativa sem APK
Com o servidor online, abra o endereço no **Chrome do Android** → menu ⋮ → **Instalar app** (ou
"Adicionar à tela inicial"). O resultado é praticamente igual ao APK, e as atualizações chegam sozinhas.
No iPhone: Safari → Compartilhar → "Adicionar à Tela de Início".

---

## Alternativa avançada: Capacitor (o app traz o jogo dentro dele)
Útil para quem quer recursos nativos. Exige Android Studio e Java.

1. Compile o cliente apontando para o servidor online:
   `SERVER_URL=https://seu-servidor.onrender.com NODE_ENV=production npm run build`
2. No servidor, libere a origem do app e mantenha a do site:
   `ALLOWED_ORIGINS=https://localhost,https://seu-servidor.onrender.com`
3. Crie o projeto Capacitor (`npm i @capacitor/core @capacitor/cli @capacitor/android`,
   `npx cap init`, `webDir` = `dist/public`, `npx cap add android`, `npx cap open android`) e gere o APK no Android Studio.

---

## Problemas comuns
| Sintoma | Causa provável |
|---|---|
| PWABuilder não encontra o manifesto | o endereço não está em HTTPS ou o servidor ainda está acordando — tente de novo |
| App abre com barra de endereço | `ANDROID_ASSETLINKS` não configurado ou Package ID/chave diferentes |
| "offline" no menu | servidor dormindo (plano gratuito) — aguarde ~1 minuto |
| Microfone não funciona | precisa de HTTPS (o Render já fornece) e permissão no Android |
| Voz não conecta entre redes diferentes | falta um servidor TURN (variável `ICE_SERVERS`) |
