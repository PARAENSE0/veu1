# Entrega v0.3 — Upgrade geral

Trabalho feito sobre o projeto da v0.2. Nada que já funcionava foi removido. A única exceção é a escolha de função no lobby, que o pedido mandou substituir pelo sorteio.

## 1. O que foi implementado

| # | Pedido | Como ficou |
|---|---|---|
| 1 | Inventário | Kit, fusível e documento empilham **até 2 no mesmo espaço** (amostra também; cartão e detector 1; sinalizador 2). A 3ª unidade fica no chão, com o aviso "Inventário cheio de X (máximo 2)". A interface mostra "n/2" nos espaços e "× n" no painel. 5 espaços (tecla 5 adicionada). |
| 2 | Mais munição e itens | 39 pontos de suprimento (antes 19) e 20 pontos de arma, todos em célula de chão dentro de salas e verificados por teste. Kits: 3 + metade dos humanos. Ativas ao mesmo tempo: 5 + nº de humanos. |
| 3 | Armas espalhadas | Ninguém começa armado. Pistola (2–6), AK-47 (1–2), **escopeta nova** (1–2) e lança-chamas (1) são sorteados em pontos de arma, em salas diferentes. A coleta é atômica no servidor: dois jogadores nunca levam a mesma arma, e ninguém carrega duas do mesmo tipo. Quem morre derruba as armas. A escopeta tem modelo próprio, coice, som de disparo e bombeamento, recarga de 2,6 s, 6 cartuchos, 8 chumbos com dispersão e queda por distância. |
| 4 | Caixa Médica | Fica na Enfermaria. Humanos **e** entidade seguram E por 1,5 s e curam 35% da vida máxima, sem passar do máximo. Uso ilimitado, sem recarga, nunca acaba. Os jogadores próximos veem a cura e a cruz pulsando. |
| 5 | Minimapa | Ampliado, mostra os nomes reais das salas e contorna a sala atual. O nome da sala atual aparece sempre embaixo do minimapa e no topo da tela. Nunca mostra a entidade. |
| 6 | Sem escolha de função | O servidor sorteia 1 entidade entre os conectados que foram entidade menos vezes. Os outros, até 8, são humanos (9 no total). A apresentação "VOCÊ É A ENTIDADE / VOCÊ É HUMANO" revela os jogadores um a um. Um pedido antigo de escolha de função é recusado pelo servidor. |
| 7 | XP e ranking semanal | O XP total não tem limite (o nível vai até 50). O **ranking semanal** zera toda segunda às 00:00 (Brasília) e tem contagem regressiva e pódio das semanas anteriores (top 10 arquivado). A virada é feita pelo servidor sem ninguém conectado, na inicialização, a cada 60 s e em toda consulta. Ela **não apaga** XP, nível, moedas, melhorias nem estatísticas. Abas: Semanal, Geral e Vitórias. |
| 8–9 | Melhorias de vida | Humano "Vida" (100→140) e "Poder de fogo" (+25% de dano no máximo); entidade "Vida" (1200→1560). Os valores saem das melhorias salvas no servidor. |
| 10 | Balanceamento | Pistola: 3 pentes. AK-47: 1 pente (24 tiros com Poder de fogo máximo). Escopeta de perto: 5 tiros (4 com Poder de fogo máximo), menos dano à distância. O servidor valida munição, cadência, alcance e paredes, e soma os chumbos num único evento de dano. |
| 11 | Entidade derrubada / morte | Sem regeneração. Vida zero por bala derruba a entidade: animação de queda, ela não anda, não ataca, não usa habilidade e as balas a ignoram. Depois de `ENTITY_DOWN_TIME` (padrão 20 s) ela levanta com a vida máxima, inclusive a da melhoria. A HUD mostra "DERRUBADA · levanta em N s". **Morte por fogo** encerra a partida na hora com vitória humana, tela de resultado e recompensas salvas. |
| 12 | Lança-chamas | Modelo, animação de equipar, jato com partículas, som, 10 de combustível/s, tanque de 100, galões de +40, alcance de 6,5 m em cone, queimadura por 3 s. Não atravessa parede. Sincronizado. |
| 13 | Códigos | **1MPARAENSE** (1.000.000 de moedas) e **2MPARAENSE** (2.000.000), uma vez por conta. PARAENSE01 não mudou. |
| 14 | Interface | Vida atual/máxima, munição do pente e da mochila, combustível, inventário com quantidades, sala atual, minimapa, tempo para a entidade levantar, melhorias, moedas, XP total e tempo até o fim da semana. Testada em 390×844, 844×390, 1024×768, 1366×768 e 1920×1080. |
| 15 | Validação no servidor | Coleta, inventário, tiros, dano, Caixa Médica, queda e morte, sorteio, melhorias, códigos e ranking são decididos pelo servidor. O cliente só envia intenções. |

Também corrigido durante os testes:

- O cenário desenhava caixotes por cima da Caixa Médica e ela ficava escondida.
- A voz podia perder a primeira oferta WebRTC se ela chegasse antes da lista da sala. Agora os sinais são guardados e reaplicados.

## 2. Arquivos

**Novos:**
- `server/weekly.ts`
- `tests/sim-balance.ts`
- `tests/e2e-nine.ts`
- `tests/support-server.ts`
- `docs/ENTREGA-v0.3.md`
- capturas novas em `docs/capturas/`: 05c, 09b, 13, 13b, 31, 45, 46, 47

**Alterados:**

- **Compartilhado:**
  - `shared/constants.ts`
  - `shared/map.ts`
  - `shared/protocol.ts`
  - `shared/upgrades.ts`
  - `shared/progression.ts`
- **Servidor:**
  - `server/match.ts`
  - `server/rooms.ts`
  - `server/accounts.ts`
  - `server/store.ts`
  - `server/http.ts`
  - `server/app.ts`
  - `server/index.ts`
  - `server/validate.ts`
  - `server/db/schema.sql`
- **Cliente:**
  - `client/src/game/game.ts`
  - `client/src/game/models.ts`
  - `client/src/game/characters.ts`
  - `client/src/game/audio.ts`
  - `client/src/game/hudstore.ts`
  - `client/src/game/world.ts`
  - `client/src/game/voice.ts`
  - `client/src/screens/Match.tsx`
  - `client/src/screens/Lobby.tsx`
  - `client/src/screens/Social.tsx`
  - `client/src/screens/Menu.tsx`
  - `client/src/screens/Settings.tsx`
  - `client/src/settings.ts`
  - `client/src/ui/Minimap.tsx`
  - `client/public/styles.css`
  - `client/public/sw.js` (cache `veu-shell-v3`)
- **Testes:**
  - `tests/unit.ts`
  - `tests/e2e-social.ts`
  - `tests/e2e-combat.ts`
  - `tests/e2e-weapons.ts`
  - `tests/e2e-match.ts`
  - `tests/browser-smoke.mjs`
  - `tests/browser-extra.ts`
  - `tests/capture-scenes.ts`
- **Configuração e documentação:**
  - `scripts/check-schema.sh`
  - `package.json` (0.3.0)
  - `render.yaml` (`ENTITY_DOWN_TIME`)
  - `README.md`
  - `docs/DESIGN.md`
  - `docs/ARQUITETURA.md`
  - `docs/ROADMAP.md`

## 3. Testes executados (resultados reais desta entrega)

| Suíte | Resultado |
|---|---|
| `tests/unit.ts` | 71/71 |
| `tests/sim-balance.ts` (simulação do servidor sem rede) | 67/67 |
| `tests/e2e-social.ts` (contas, códigos, XP sem limite, virada da semana) | 82/82 |
| `tests/e2e-combat.ts` | 32/32 |
| `tests/e2e-weapons.ts` (armas pela rede) | 22/22 |
| `tests/e2e-weapons.spec.ts` (armas e suprimentos, regras v0.3 — ver seção 6) | 36/36 |
| `tests/e2e-nine.ts` (**9 jogadores conectados ao mesmo tempo**) | 19/19 |
| `tests/e2e-match.ts` (partidas completas com bots) | 56/56 |
| `tests/browser-smoke.mjs` (Chrome real) | 54/54 |
| `tests/browser-extra.ts` (Chrome real, PC e celular) | 31/31 |
| `scripts/check-schema.sh` (PostgreSQL real, temporário) | OK |

Total: **385** verificações em Node, **85** no navegador e o schema validado.

| Item do pedido | Onde foi testado |
|---|---|
| Inventário 2 por tipo / 3ª recusada / aviso | sim-balance [3]; e2e-weapons [4]; browser-smoke (inventário) |
| Itens e munição sem cair em parede ou fora do mapa | unit [pontos de coleta] (39 suprimentos, 20 armas, 34 itens em chão livre, sem repetição); sim-balance [1] |
| Armas aleatórias, máximos, sem duplicação | sim-balance [1][2] (dois humanos no mesmo tick); e2e-nine [3] (8 humanos na mesma AK-47 → só 1) |
| Escopeta funcional | sim-balance [6]; e2e-weapons [2][3]; browser-smoke (pegar com E, atirar, recarregar, trocar com Q) |
| Caixa Médica | sim-balance [9] (300 usos seguidos, entidade usa, vida máxima respeitada, longe não funciona); e2e-weapons [6]; e2e-nine [4] |
| Minimapa com nomes | browser-extra (nome da sala embaixo, minimapa segue o servidor, celular amplia e reduz) |
| Sorteio de funções | sim-balance [11] (27 partidas: cada um dos 9 foi entidade 3 vezes); e2e-nine [1][2]; browser-smoke (sem botão de função, apresentação) |
| XP sem limite / ranking semanal | e2e-social [11] (500 bilhões de XP), [12] (virada da semana, histórico, nada apagado) |
| Melhorias de vida | sim-balance [10]; browser-extra (HUD 140/140) |
| Balanceamento das armas | sim-balance [4]–[7] |
| Derrubada e morte por fogo | sim-balance [4][7]; e2e-weapons [5]; e2e-nine [5][6]; browser-extra (HUD "derrubada" em 3 páginas) |
| Códigos 1M e 2M | e2e-social [10]; check-schema |
| 9 jogadores simultâneos | e2e-nine (9 conexões WebSocket reais; o 10º é recusado) |

Sobre a estabilidade dos testes de navegador:

- **Voz:** o teste de voz falha às vezes neste ambiente sem internet. O jogador que faz a oferta WebRTC fica parado coletando candidatos ICE (0 candidatos) e a conexão não sai de "new". Abrir o Chrome do teste com `--disable-features=WebRtcHideLocalIpsWithMdns` **não resolveu**: na v0.3.1 o teste falhou em 3 de 4 execuções (depois de ter passado em 4 de 4 na entrega da v0.3). Isso não foi reproduzido fora deste ambiente, e a voz em rede real não foi testada.
- **9 jogadores:** o teste "8 humanos na mesma AK-47" falhou uma vez com 2 donos. A causa era uma segunda AK-47 sorteada no mesmo ponto de arma, ao lado da que o teste colocou; não era duplicação. O teste agora usa um ponto sem outras armas a 5 m e passou em 5 de 5 execuções. A coleta simultânea de uma única arma também é testada em sim-balance [2].
- **Minimapa:** a checagem "minimapa segue o servidor" falhou uma vez por tempo (renderização por software a cerca de 15 FPS). Agora ela espera até 3 s pela reconciliação.

## 4. Atualizar o GitHub e publicar no Render

1. Descompacte o ZIP e copie o conteúdo da pasta `veu/` por cima da pasta do seu repositório, mantendo a pasta `.git`.
2. No terminal, dentro da pasta:
   ```bash
   git add -A
   git commit -m "VÉU v0.3 - upgrade geral"
   git push
   ```
   Pelo site do GitHub também dá: *Add file → Upload files*, arraste os arquivos e confirme.
3. O Render reimplanta sozinho após o push. Se não reimplantar, use *Manual Deploy → Deploy latest commit*. O build é o mesmo de antes (`npm install --include=dev && npm run build`).
4. Opcional: em *Environment*, ajuste `ENTITY_DOWN_TIME` (tempo da entidade derrubada, de 3 a 120 s). O `render.yaml` já cria a variável com 20.
5. Teste em `https://SEU-APP.onrender.com/api/health`, depois abra o jogo e resgate 1MPARAENSE numa conta registrada.
6. O APK não precisa ser refeito. O service worker mudou para `v3`, então o app baixa a interface nova ao abrir. Se aparecer a versão antiga, feche e abra o app duas vezes.

## 5. Problemas e pendências reais

- **Persistência no Render gratuito:** o adaptador PostgreSQL (`PgStore`) ainda **não** foi escrito. O schema está pronto e validado, com as tabelas novas do ranking semanal. No plano gratuito o arquivo de dados some a cada reinício ou deploy, e com ele contas, XP, ranking semanal e códigos resgatados. Para guardar de verdade: disco pago no Render (`DATA_FILE`) ou o PgStore.
- **Ranking semanal no plano gratuito:** o servidor do Render "dorme" sem acesso. A virada da semana acontece quando ele acorda (na inicialização e na primeira consulta), então o resultado é o mesmo, só que registrado mais tarde.
- **Modelos:**
  - armas, Caixa Médica, criatura e humanos são malhas procedurais feitas por código, não modelos de artista;
  - os sons são sintetizados;
  - a animação de queda e de levantar da entidade é procedural.
- **Sem testes em aparelhos reais:** só Chrome no ambiente de teste, com renderização por software e toque emulado. Não houve teste em celular físico, Safari, Firefox ou com 9 pessoas reais (os 9 jogadores do teste são conexões automáticas).
- **Uma única entidade** (O Reverberante). A Tecelã e O Hiato continuam só projetadas.
- **Sem compensação de latência** nos tiros.
- **Sem verificação de versão do protocolo** na conexão. Um cliente antigo aberto durante o deploy pode se comportar mal até recarregar a página.
- O `npm run typecheck` com os tipos oficiais não roda aqui (sem internet para `@types`). A checagem foi feita com `tsconfig.offline.json`, sem erros.

## 6. Correção v0.3.1 — erro de compilação no Render

**Erro:** `No matching export in "shared/constants.ts" for import "ENTITY_HP_PER_SURVIVOR"` em `tests/e2e-weapons.spec.ts:14`.

**Causa:**
- O `npm run build` (o mesmo comando do Render) compila todos os `tests/*.ts`.
- O repositório tinha um `tests/e2e-weapons.spec.ts` com o conteúdo antigo do teste de armas da v0.2. A linha 14 é idêntica à do `tests/e2e-weapons.ts` da v0.2.
- Na v0.3, `ENTITY_HP_PER_SURVIVOR` (+300 de vida por sobrevivente) e a regeneração da entidade foram **removidas de propósito**, porque o upgrade pediu vida fixa: 1.200, até 1.560 com a melhoria "Vida", e a entidade só se cura na Caixa Médica.
- O teste usava um nome que não existe mais. Não era uma constante renomeada.
- O erro foi reproduzido aqui com o mesmo arquivo e com a mesma linha e coluna (14:25).

**Correção (sem mudar o balanceamento):**
- `tests/e2e-weapons.spec.ts` foi **atualizado para as regras da v0.3**, sem ser apagado. A verificação "vida escala com a equipe" passou a ser "vida fixa em `ENTITY_HP_BASE` (1200)". Isso é o que o servidor faz hoje.
- O restante do teste também foi adaptado às regras atuais:
  - todos começam desarmados;
  - o sorteio de função é do servidor;
  - a reserva máxima da AK-47 é 120;
  - bala derruba, e só o fogo mata de vez.
- Ficou com **36 verificações**, todas aprovadas, e entrou no `npm test`.
- Nenhum valor de `shared/constants.ts` foi alterado.

**Outras importações conferidas:**
- O `tsc` sobre todo o projeto (incluindo `tests/`) não mostrou erros.
- Também compilei contra o código atual **todas as versões antigas dos testes** (v0.1 e v0.2). A única importação quebrada era a do teste de armas antigo, já corrigida.
- Nenhum arquivo do jogo usa constantes removidas (`ENTITY_HP_PER_SURVIVOR`, `ENTITY_REGEN`, `ENTITY_REGEN_DELAY`).

**Ao subir para o GitHub:** copie o conteúdo do ZIP por cima do repositório. O novo `tests/e2e-weapons.spec.ts` substitui o antigo. Se o repositório tiver outros arquivos de teste que não estão no ZIP, eles também são compilados no Render; confira com `git status` antes do commit.

**Testes de navegador nesta rodada:**
- `browser-extra`: a checagem do HUD da entidade derrubada falhou uma vez. O clique do jogador saiu antes de a mira do cliente chegar ao alvo (renderização por software). Agora o teste repete o clique, no máximo 6 vezes, até a entidade cair, e verifica isso separadamente. Ficou com 31 verificações e passou em 3 de 3 execuções.
- `browser-smoke`: 53/54. A falha é a voz, descrita na seção 3.
