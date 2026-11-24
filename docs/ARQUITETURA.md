# Arquitetura técnica

## Visão geral

```
 Navegador (React + renderizador WebGL2)          Servidor Node.js (autoritativo)
 ┌──────────────────────────────────────┐        ┌────────────────────────────────────┐
 │ Telas React (menus, lobby, HUD)      │  HTTP  │ API REST: contas, perfil, loja,     │
 │ GameClient: entrada → comandos 30 Hz ├───────►│ histórico, config de voz            │
 │  predição local (shared/physics)     │   WS   │ RoomManager: salas, lobby, códigos  │
 │  interpolação de remotos (110 ms)    │◄──────►│ Match: simulação a 30 Hz, regras,   │
 │  render WebGL2, áudio Web Audio      │        │  objetivos, entidade, resultados    │
 │ Voz: WebRTC P2P (sinalização via WS) │        │ Accounts + Store (FileStore → PG)   │
 └──────────────────────────────────────┘        └────────────────────────────────────┘
                      shared/: mapa, física, constantes, protocolo, progressão
```

O código em `shared/` é usado pelos dois lados: o servidor decide, o cliente apenas prevê (para não sentir atraso) e corrige quando o servidor responde.

## Estrutura de pastas

```
veu/
├── shared/                 código comum cliente/servidor
│   ├── constants.ts        balanceamento (velocidades, recargas, danos, tempos)
│   ├── map.ts              MapBuilder + Complexo Abissal (salas, portas, luzes, estações)
│   ├── physics.ts          colisão círculo×grid, movimento determinístico, linha de visão
│   ├── protocol.ts         tipos das mensagens e snapshots
│   ├── progression.ts      cosméticos, conquistas, níveis (teto 50), temporadas
│   ├── upgrades.ts         melhorias permanentes e seus modificadores (modsFor)
│   └── rng.ts              aleatório com semente
├── server/
│   ├── index.ts            ponto de entrada (variáveis de ambiente)
│   ├── app.ts              HTTP + WebSocket, limites de taxa, roteamento de mensagens
│   ├── http.ts             API REST, arquivos estáticos, cabeçalhos de segurança
│   ├── accounts.ts         scrypt, sessões, perfil, loja, recompensas, melhorias,
│   │                       códigos de presente, ranking, amigos
│   ├── rooms.ts            salas, lobby, sorteio da entidade, ciclo da partida
│   ├── match.ts            simulação autoritativa da partida
│   ├── tasks.ts            sorteio e estado dos objetivos
│   ├── validate.ts         esquemas zod de todas as mensagens
│   ├── store.ts            interface Store + FileStore
│   └── db/schema.sql       schema PostgreSQL de produção
├── client/
│   ├── public/             index.html, styles.css, ícone
│   └── src/
│       ├── main.tsx, App.tsx, store.ts, session.ts, net.ts, settings.ts
│       ├── screens/        Entry, Menu, Lobby, Match (HUD + toque), Profile, Settings, Results,
│       │                   Social (Perfil, Ranking, Amigos, Melhorias, Código de presente)
│       ├── ui/             componentes (kit), pré-visualização 3D, Minimap
│       └── game/           game.ts, renderer.ts, world.ts, models.ts (armas/caixas),
│                           characters.ts (humanos e criatura), meshes.ts (malhas orgânicas),
│                           aim.ts (assistência de mira), textures.ts, audio.ts, input.ts,
│                           voice.ts, hudstore.ts, math.ts
├── tests/                  unit.ts, e2e-social.ts, e2e-combat.ts, e2e-weapons.ts,
│                           e2e-match.ts (bots), browser-smoke.mjs (Chrome), model-shots.mjs
├── scripts/                build.mjs (esbuild), check-schema.sh
├── typings-offline/        tipos mínimos usados só quando não há @types (ver abaixo)
└── docs/                   ARQUITETURA, DESIGN, ROADMAP, capturas
```

## Tecnologias escolhidas e justificativas

| Camada | Escolha | Por quê |
|---|---|---|
| Interface | React 19 + TypeScript | Pedido na especificação; telas declarativas; HUD lê um store próprio (~12 atualizações/s) para não renderizar o React a cada quadro |
| 3D | Renderizador WebGL2 próprio | O ambiente de desenvolvimento não tinha acesso à internet para instalar Three.js. Em vez de simular, foi escrito um renderizador enxuto: iluminação por pixel (16 luzes + 6 lanternas), neblina, texturas procedurais num único `TEXTURE_2D_ARRAY` (o mapa inteiro em 1 chamada de desenho), partículas. Fica isolado em `client/src/game/renderer.ts`, então migrar para Three.js no futuro é localizado |
| Tempo real | WebSocket puro (`ws`) | Sem a camada extra do Socket.IO: mensagens menores e controle total do protocolo. Reconexão, ping e salas são implementados no próprio jogo |
| Validação | zod | Toda mensagem recebida é validada (tipo, limites numéricos, tamanhos) antes de chegar às regras |
| Persistência | Interface `Store` + `FileStore` (JSON atômico) | Funciona sem infraestrutura. O `schema.sql` do PostgreSQL está pronto e testado (`scripts/check-schema.sh`); falta escrever o `PgStore` com o pacote `pg` (não foi possível instalá-lo aqui) |
| Voz | WebRTC (malha P2P, só áudio) | Sem servidor de mídia; sinalização pelo WebSocket do jogo. Para mais de ~8 pessoas ou redes restritas, considerar um SFU (ex.: LiveKit) |
| Build | esbuild | Compila cliente e servidor em menos de 1 s |
| Testes | Bots WebSocket + Playwright/Chrome | Partidas completas testadas de ponta a ponta, inclusive o 3D e a voz |

## Rede e autoridade do servidor

- **Comandos de entrada**: o cliente envia a intenção (eixos, olhar, correr, agachar) a 30 Hz, cada comando vale exatamente 1 tick. O servidor aplica no máximo 1 comando por tick em média (rajada limitada a 4, fila máxima de 8) — **speedhack não funciona** (teste: mandar 4× mais comandos não acelera).
- **Predição e reconciliação**: o cliente aplica os comandos localmente com o mesmo `stepMove` do servidor; cada snapshot traz o último comando confirmado (`ack`), o cliente volta à posição oficial e reaplica os pendentes. A diferença visual é suavizada.
- **Interpolação**: jogadores remotos são desenhados 110 ms no passado entre snapshots (15/s).
- **Ações** (interagir, atacar, habilidades, itens) são pedidos: o servidor verifica alcance, linha de visão, recargas, função do jogador e estado.
- **Visibilidade filtrada por jogador**: a entidade não recebe sobreviventes escondidos nem fora de visão; sobreviventes só recebem a entidade com linha de visão ou a até 14 m; itens só aparecem com linha de visão (até 30 m). Isso reduz o efeito de "wallhack".
- **Desconexão e reconexão**: no lobby, o jogador é removido após 15 s; na partida, o personagem fica parado por até 60 s e o jogador pode voltar (recebe a partida de novo). Depois disso, sobrevivente morre e entidade perde.
- **Resultados** (vencedor, pontuação, XP, moedas, conquistas) são calculados e gravados só no servidor.

## Segurança

- Senhas com **scrypt** e sal aleatório; comparação em tempo constante; login calcula o hash mesmo para usuário inexistente.
- Tokens de sessão aleatórios (32 bytes), guardados apenas como SHA-256; expiração de 14 dias; logout invalida.
- Limite de taxa por IP na API (240/min; 20/min em login/cadastro) e por conexão no WebSocket (90 msg/s, conexão encerrada após abuso).
- Tamanho máximo de corpo (8 KB) e de mensagem WS (64 KB); validação zod em tudo; textos livres (chat, nome de sala) têm caracteres de controle removidos e o React escapa o HTML.
- Cabeçalhos: CSP restrita, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- WebSocket pode exigir origem (`ALLOWED_ORIGINS`). Uma conta só tem uma conexão ativa por vez (a antiga é encerrada).
- Sinalização de voz só é repassada entre membros da mesma sala e, durante a partida, só entre sobreviventes (a entidade não escuta nem é escutada). Ao entrar na partida, os clientes fecham as conexões de voz não permitidas.
- Limitações conhecidas: a regra "vivos não ouvem mortos" na voz é aplicada no cliente; o atraso de afinação dos ecos falsos poderia ser analisado por um cliente modificado (é sutil e propositalmente sobreposto aos sons reais).

## Desempenho

- Mapa estático em **uma** chamada de desenho; objetos dinâmicos só a até 40 m; luzes escolhidas por proximidade (8/12/16 conforme a qualidade).
- Configurações: qualidade (baixa/média/alta), escala de resolução, texturas 128–512 px, sombras de contato, partículas, granulação, campo de visão, áudio HRTF ou estéreo.
- Sedimentos em suspensão simulados num volume que acompanha a câmera (quantidade conforme a qualidade).
- Medido no teste com renderização **por software** (sem GPU): ~10 FPS com duas janelas abertas e ~150 chamadas de desenho. Com GPU, o custo é muito menor; ainda assim, ver "Próximos passos de otimização" no ROADMAP.

## Infraestrutura externa (produção)

1. **HTTPS/WSS**: obrigatório para microfone fora do localhost. Use um proxy reverso (Caddy/Nginx) na frente de `npm start` e defina `TRUST_PROXY=1`.
2. **TURN** para voz (coturn ou serviço gerenciado) via `ICE_SERVERS`.
3. **PostgreSQL**: aplicar `server/db/schema.sql`, instalar `pg` e implementar `PgStore` (mesma interface de `server/store.ts`).
4. Para várias instâncias: salas ficam na memória do processo; distribuir jogadores por instância (ex.: código da sala → instância) ou usar um diretório de salas compartilhado (Redis).

## Sobre `typings-offline/`

O ambiente onde o projeto foi escrito não tinha `@types/react` e `@types/ws`. Para manter a checagem de tipos ativa, `tsconfig.offline.json` inclui declarações mínimas. Num ambiente normal, `npm install` traz os tipos oficiais e `npm run typecheck` usa só o `tsconfig.json`. Os manipuladores de evento usam tipos estruturais compatíveis com os eventos do React.

## Progressão, social e segurança (v0.2)
- **Recompensas só no servidor**: XP/fragmentos vêm do resultado calculado pela simulação; cada partida recompensa uma conta uma única vez (`rewardedMatches`); o XP para no teto do nível 50.
- **Códigos de presente**: normalizados (maiúsculas), verificados e aplicados sem nenhuma espera entre a checagem e a gravação (o Node é de uma thread só, então dois pedidos simultâneos não passam juntos — testado com 3 pedidos paralelos). Limite de 10 tentativas/min por conta. No PostgreSQL, a chave primária `(code, user_id)` em `code_redemptions` garante o mesmo.
- **Administração**: `/api/admin/codes` exige o cabeçalho `x-admin-token` (comparação em tempo constante); sem `ADMIN_TOKEN` configurado, a rota responde 403.
- **Melhorias**: o servidor confere preço, saldo e nível máximo; os efeitos são calculados por `modsFor()` no início da partida (o cliente recebe os mesmos valores só para a predição de movimento).
- **Amigos**: listas guardadas nos dois lados; pedidos cruzados viram amizade; convidados não participam; presença vem das conexões WebSocket ativas.
- **Persistência**: `FileStore` grava tudo (contas, melhorias, amigos, códigos, histórico) em JSON com escrita atômica; `server/db/schema.sql` tem as 14 tabelas equivalentes para produção.

## Personagens 3D
`meshes.ts` gera superfícies de revolução com seção elíptica e normais suaves (elipsoides, membros afunilados com articulações arredondadas, espinhos, montagem de peças). `characters.ts` monta a criatura e os humanos como cadeias de articulações animadas proceduralmente (andar, correr, agachar, perseguir, atacar, golpe especial, dano, morte; nos humanos, IK de dois ossos segura a arma com as duas mãos). Cada personagem usa ~20 chamadas de desenho e as malhas são criadas uma vez por contexto WebGL. Para usar modelos de artista no futuro, basta substituir as funções de construção por malhas importadas mantendo os mesmos pontos de articulação.
