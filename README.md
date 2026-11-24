# VÉU: Ecos da Ruptura

Terror multiplayer assimétrico para navegador: **1 entidade contra até 8 sobreviventes** em uma instalação científica submarina. Projeto original — personagens, criatura, mapa, texturas, sons e interface foram criados do zero (texturas e áudio são gerados por código; não há arquivos de terceiros).

![A criatura no Laboratório Principal, sob a luz de emergência](docs/capturas/40-laboratorio-criatura.png)

## Estado atual — versão 0.2

| Funciona e foi testado | Ainda não implementado |
|---|---|
| Contas (cadastro, login, convidado), sessões seguras, **progresso permanente salvo automaticamente no servidor** | Mapas 2 e 3 (Setor Helix, Estação Ártica) — projetados em `docs/DESIGN.md` |
| **Nível máximo 50** com curva progressiva, XP por participação, desempenho, vitória, fuga/sobrevivência e **MVP (+20%)** | Entidades 2 e 3 (A Tecelã, O Hiato) — projetadas em `docs/DESIGN.md` |
| **Ranking online** (por XP ou vitórias, posição própria, atualização automática, sem duplicados) | Adaptador PostgreSQL (schema pronto e validado; falta o código com o pacote `pg`) |
| **Amigos**: busca por nome/ID, pedidos, aceitar/recusar/cancelar/remover, presença (offline/online/lobby/partida), convite para a sala, notificações em tempo real | Modelos esculpidos por artista (os atuais são malhas orgânicas procedurais) |
| **Melhorias permanentes** (5 de humano, 5 de monstro, 5 níveis cada) com efeito real na partida, aplicado pelo servidor | Compensação de latência nos tiros |
| **Código de presente** (PARAENSE01 = nível 50 + 20.000 fragmentos, uma vez por conta) e administração de novos códigos | Pagamentos reais (fora do escopo, por pedido) |
| **Combate reequilibrado**: golpe comum = 18% da vida; nenhum monstro derruba um humano com 2 golpes comuns; **Golpe Brutal** especial com recarga | |
| **Portas automáticas** para humanos, **estamina** com recuperação mais rápida parado, **iluminação** verificada célula por célula | |
| **Minimapa** no canto superior esquerdo (amplia ao clicar ou com M) e **assistência de mira** (não atira sozinha) | |
| **Nova criatura** baseada na imagem de referência e **humanos orgânicos** (sem cubos), com animações | |
| Salas com código, partida rápida, chat, voz WebRTC, armas e suprimentos, objetivos em 3 fases, espectador | |
| Controles de PC (configuráveis) e de toque; PWA/APK | |

## Como rodar

Requisitos: **Node.js 20+** e um navegador com WebGL2 (Chrome, Edge, Firefox, Safari 15+).

```bash
npm install
npm run build
npm start            # http://localhost:8080
```

Abra duas janelas (ou dois dispositivos na mesma rede, em `http://IP-DO-PC:8080`), entre com contas diferentes (ou como convidado), crie uma sala em uma e entre pelo código na outra. São necessários 2 jogadores para iniciar.

Desenvolvimento com recompilação automática: `npm run dev`.

### Testes

```bash
npm test               # unitários (62) + contas/social/códigos (64) + combate/portas/estamina (32)
                       # + armas e suprimentos (33) + partida completa com bots (56)
npm run test:browser   # Chrome real: menus, código, melhorias, partida 3D, minimapa, armas, voz (49)
node tests/model-shots.mjs     # capturas dos modelos 3D em várias poses (revisão visual)
bash scripts/check-schema.sh   # valida o schema PostgreSQL numa instância temporária
npm run typecheck
```

`npm run test:browser` usa o Playwright; defina `CHROME=/caminho/do/chrome` se necessário.

## Controles (padrão — todos configuráveis)

| PC | Sobrevivente | Entidade |
|---|---|---|
| WASD / mouse | mover / olhar | mover / olhar |
| Shift | correr | — |
| Ctrl | agachar | espreitar (camuflagem) |
| E (segurar) | interagir, entregar, consertar, resgatar | portas, vasculhar armários |
| F | lanterna | Parasita |
| Botão esq. / Q ou roda / R | atirar / trocar arma / recarregar | — |
| Tab / 1–4 | inventário / usar item | — |
| Botão esq. / Botão dir. | — | atacar / Golpe Brutal (especial) |
| Q / R / Espaço | — | Rastro / Eco Falso / Ruptura |
| M | ampliar/reduzir minimapa | idem |
| T | ligar/desligar assistência de mira | — |
| Z ou roda | — | trocar o som do Eco Falso |
| C / V / Esc | câmera 1ª-3ª pessoa / falar / menu | idem |

No celular aparecem joystick, área de toque para olhar e botões de ação.

## Configuração de produção

| Variável | Uso |
|---|---|
| `PORT`, `HOST` | endereço do servidor (padrão `0.0.0.0:8080`) |
| `DATA_FILE` | arquivo de dados (padrão `./data/db.json`) |
| `TRUST_PROXY=1` | atrás de proxy reverso (Nginx, Caddy) |
| `ALLOWED_ORIGINS` | origens aceitas no WebSocket, separadas por vírgula |
| `ANDROID_ASSETLINKS` | conteúdo do `assetlinks.json` gerado pelo PWABuilder (remove a barra de endereço do APK) |
| `ADMIN_TOKEN` | senha da administração de códigos de presente (sem ela a rota fica bloqueada) |
| `ICE_SERVERS` | JSON com STUN/TURN para a voz, ex.: `[{"urls":"turn:turn.seudominio.com:3478","username":"u","credential":"s"}]` |

### Códigos de presente

O código **PARAENSE01** é criado automaticamente na primeira inicialização (nível 50 + 20.000 fragmentos, uma vez por conta registrada). Para cadastrar novos códigos sem mexer no código-fonte:

```bash
curl -X POST https://SEU-SERVIDOR/api/admin/codes -H "x-admin-token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code":"NATAL2026","coins":1000,"xp":500,"maxUses":100,"expires":"2026-12-31T23:59:59Z"}'
curl https://SEU-SERVIDOR/api/admin/codes -H "x-admin-token: $ADMIN_TOKEN"   # lista códigos e usos
```

O que precisa ser providenciado fora do código: **HTTPS/WSS** (o microfone só funciona em HTTPS ou localhost), um **servidor TURN** (ex.: coturn) para voz entre redes restritivas, e — quando migrar — **PostgreSQL** (`server/db/schema.sql`). Detalhes em `docs/ARQUITETURA.md`.

## Celular / APK

O jogo funciona como aplicativo instalável (PWA) e pode virar APK. Passo a passo completo em **`docs/PUBLICAR-ANDROID.md`** (hospedagem no Render com `render.yaml` + geração do APK no PWABuilder).

## Documentação

- `docs/ARQUITETURA.md` — estrutura de pastas, tecnologias e justificativas, rede, segurança, desempenho.
- `docs/DESIGN.md` — documento de game design: regras, entidades, mapas, objetivos, balanceamento.
- `docs/ROADMAP.md` — plano por etapas com o que foi concluído e o que falta.
- `docs/PUBLICAR-ANDROID.md` — hospedar o servidor e gerar o APK.
