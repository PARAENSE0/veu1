# Entrega v0.2 — atualização "Prompt Master"

Projeto atualizado sobre a base existente (mesma estrutura de pastas, `render.yaml`, scripts e configurações preservados).

## 1. Funcionalidades implementadas

| Área | O que funciona (com servidor e persistência) |
|---|---|
| XP e níveis | Teto no **nível 50** (98.000 XP, curva progressiva de 200 + 75×nível). XP por participação, desempenho, vitória, fuga (+60) ou sobrevivência (+40) e **MVP +20%**. Após o 50, o XP para e os fragmentos continuam. Barra de progresso mostra "NÍVEL MÁXIMO". |
| Ranking | `/api/ranking` por XP ou vitórias: posição, nome, nível, XP, vitórias, partidas; destaque e posição do próprio jogador; atualiza sozinho a cada 10 s; sem duplicados; convidados ficam de fora. |
| Amigos | Busca por nome ou ID, enviar/aceitar/recusar/cancelar/remover, pedido cruzado vira amizade, lista com nível e status (offline/online/no lobby/em partida + "visto há…"), convite para a sala com aviso em tempo real e botão "Entrar", notificações de pedido/aceite. |
| Conta e progresso | Salvamento automático no servidor de nível, XP, fragmentos, melhorias, amigos, pedidos, estatísticas, conquistas, histórico de recompensas, códigos resgatados e partidas já recompensadas (sem recompensa duplicada). |
| Melhorias | 5 de humano (estamina máxima, recuperação, velocidade, resistência física, velocidade de interação) e 5 de monstro (velocidade, resistência, poder de ataque, recuperação de habilidades, eficiência), 5 níveis cada, custo/saldo/máximo validados no servidor, efeito real na partida. |
| Código de presente | Campo **CÓDIGO DE PRESENTE**; **PARAENSE01** → nível 50 + 20.000 fragmentos, uma vez por conta (mensagens de sucesso, "Código inválido." e "Você já resgatou este código."); administração de novos códigos com `ADMIN_TOKEN`. |
| Combate | Golpe comum = 18% da vida; **Golpe Brutal** (botão direito) 34% com preparação de 0,8 s e recarga; nenhum monstro derruba com 2 golpes comuns (nem com ataque no máximo); um alvo por golpe; nada através de paredes ou fora do alcance. |
| Humanos | Estamina com recuperação gradual (mais rápida parado), barra com % e aviso de fôlego baixo, bloqueio da corrida quando esgotada; portas automáticas; interação mais rápida com a melhoria; arma segura com as duas mãos (IK). |
| Monstro | Mesmas habilidades (Rastro, Eco Falso, Ruptura, Parasita) + Golpe Brutal; melhorias de velocidade, resistência, ataque, recarga e duração. |
| Portas | Abrem para humanos a 0,9 m, fecham 1,5 s depois, nunca com alguém no vão; entidade abre manualmente; portas de segurança e travadas pelo Parasita mantêm as regras; predição no cliente para não "bater" na porta. |
| Iluminação | Verificação célula a célula com linha de visão nos dois estados de energia; luzes de preenchimento onde faltava (241 luzes; renderizador usa as 16 mais próximas). |
| Minimapa | Canto superior esquerdo, planta real, portas (abertas/fechadas/travadas), posição e direção em tempo real, companheiros visíveis e objetivos ativos; clique/toque ou M amplia, ✕/clique reduz. Não mostra a entidade (nem sobreviventes para a entidade). |
| Mira | Assistência suave (cone pequeno, alcance da arma, linha de visão, não age na entidade camuflada), fricção sobre o alvo, nunca atira sozinha; Automático = forte no toque, média no mouse; configurável (Forte/Média/Leve/Desligada) e tecla T. |
| Novo monstro | Criatura da imagem de referência com malhas orgânicas e texturas próprias; animações de parado, andar, correr/perseguir, espreitar, ataque, golpe especial, dano e morte. |
| Humanos 3D | Corpo orgânico (sem cubos) com rosto, cabelos, barba, acessórios, uniformes; animações de andar, correr, agachar, caído, canalizar, mirar, recarregar e reação a golpe. |
| Menu | JOGAR, PERFIL, RANKING, AMIGOS, MELHORIAS, CÓDIGO DE PRESENTE, ESTATÍSTICAS, CONFIGURAÇÕES (Personalização, Loja, Inventário e Histórico dentro de Perfil). |
| Banco de dados | `server/db/schema.sql` com 14 tabelas (amizades, pedidos, melhorias, códigos, resgates, histórico de recompensas, partidas recompensadas) e restrições contra duplicação/manipulação, validado em PostgreSQL real. |

## 2. Arquivos

**Criados:** `shared/upgrades.ts`, `client/src/game/aim.ts`, `client/src/game/characters.ts`, `client/src/game/meshes.ts`, `client/src/screens/Social.tsx`, `client/src/ui/Minimap.tsx`, `tests/e2e-social.ts`, `tests/e2e-combat.ts`, `tests/browser-extra.ts`, `tests/capture-scenes.ts`, `tests/model-shots.mjs`, `tests/harness/models.ts`, `docs/ENTREGA-v0.2.md`, novas capturas em `docs/capturas/` (04, 05, 06b, 06c, 08b, 11b, 40–44).

**Modificados:** `README.md`, `render.yaml`, `package.json`, `scripts/check-schema.sh`, `server/{accounts,app,http,index,match,rooms,store,validate}.ts`, `server/db/schema.sql`, `shared/{constants,map,physics,progression,protocol}.ts`, `client/public/{styles.css,sw.js}`, `client/src/{App.tsx,session.ts,settings.ts,store.ts}`, `client/src/game/{game,hudstore,models,textures}.ts`, `client/src/screens/{Match,Menu,Profile,Results,Settings}.tsx`, `client/src/ui/Preview.tsx`, `tests/{unit.ts,browser-smoke.mjs}`, `docs/{ARQUITETURA,DESIGN,ROADMAP}.md`, `docs/capturas/03-menu.png`.

**Removidos:** capturas antigas que mostravam o monstro anterior (`docs/capturas/08, 15, 20, 21, 31`).

## 3. Relatório de testes (todos executados nesta entrega)

| Suíte | Como rodar | Resultado |
|---|---|---|
| Unitários (núcleo, iluminação, malhas, mira, combate, estamina) | `npm test` | 62/62 |
| Contas, ranking, amigos, códigos, melhorias, persistência após reinício | `npm test` (`e2e-social`) | 64/64 |
| Combate, portas automáticas, estamina, efeito das melhorias | `npm test` (`e2e-combat`) | 32/32 |
| Armas e suprimentos (regressão) | `npm test` (`e2e-weapons`) | 33/33 |
| Partida completa com bots (regressão) | `npm test` (`e2e-match`) | 56/56 |
| Navegador: menus, código, melhorias, partida 3D, minimapa, armas, voz | `npm run test:browser` | 49/49 |
| Navegador: 5 resoluções, HUD/minimapa sem sobreposição, mira PC/celular, parede | `npm run test:browser` (`browser-extra`) | 27/27 |
| Schema PostgreSQL (aplicado 2×, restrições anti-duplicação) | `bash scripts/check-schema.sh` | 14 tabelas, 4/4 restrições |
| Revisão visual dos modelos (15 poses) | `node tests/model-shots.mjs` | capturas revisadas |

Correspondência com os 42 testes pedidos:

| # | Item | Onde foi testado |
|---|---|---|
| 1–2 | Cadastro, login | browser-smoke [1]; e2e-social [9] (login após reinício, senha errada) |
| 3–4 | Salvamento e recuperação do progresso | e2e-social [9]: servidor reiniciado com o mesmo arquivo — nível, XP, fragmentos, melhorias, amigos, códigos, histórico mantidos |
| 5 | Ranking online | e2e-social [6]; browser-smoke (tabela com destaque) |
| 6–7 | Amigos e solicitações | e2e-social [7] (busca nome/ID, pedido, repetido, aceitar, recusar, cancelar, cruzado, remover) |
| 8 | Status online/offline | e2e-social [8] (menu → lobby → partida → offline, "visto por último") |
| 9 | Convites | e2e-social [8] (convite em tempo real com código e entrada na sala; não-amigo recusado) |
| 10 | Estamina | unit [estamina]; e2e-combat [8]; browser-smoke (máximo 105 com a melhoria) |
| 11 | Portas automáticas | e2e-combat [7] (abre, sincroniza, não fecha com alguém no vão, atraso, fecha, atravessar andando, entidade não aciona, travada continua travada) |
| 12–13 | Melhorias humanas e de monstro | e2e-social [5] (compra/saldo/máximo); e2e-combat (efeito real: estamina 125, resistência 85%, ataque ×1,15, recarga) |
| 14–17 | PARAENSE01, 20.000, nível 50, resgate repetido | e2e-social [2][4][9] (inclusive 3 resgates simultâneos e após reinício); browser-smoke pela interface |
| 18–20 | Vida, dano, especiais | e2e-combat [1]–[6] (2 golpes = 41,4 de dano no máximo; 5 golpes para derrubar; especial 39,1 com recarga) |
| 21 | Colisões | e2e-combat [4] (sem dano através de parede/fora de alcance), [7] (atravessar porta sem ficar preso); e2e-match (bots navegando) |
| 22–23 | Multiplayer e sincronização | e2e-match; browser-smoke (posição prevista = servidor, 0,00 m); browser-extra (minimapa segue o servidor) |
| 24 | Diferentes resoluções | browser-extra [1] (390×844, 844×390, 1024×768, 1366×768, 1920×1080) e HUD em 1366×768 e 844×390 |
| 25–27 | Iluminação de cômodos, corredores e passagens; sem áreas escuras | unit [iluminação] (1.016 células, energia ligada e desligada) + capturas 40/41 |
| 28–31 | Minimapa: funciona, tempo real, mapa real, ampliar/reduzir | browser-smoke (posição, tecla M); browser-extra (toque, ✕, posição do servidor); desenhado a partir de `map.cells` |
| 32–36 | Mira: ajuda, suavidade, paredes, PC, celular | unit [assistência de mira]; browser-extra [2] (PC 7,8°→2,4°, celular 5,1°→0,0°, sem disparo, parede = sem ajuda) |
| 37–39 | Novo monstro, integração, animações | model-shots (15 poses); unit [modelos 3D] (faces orientadas, orçamento de vértices); capturas 40/42/44 |
| 40–41 | Colisões/movimento e sincronização do novo modelo | e2e-match/e2e-combat (mesma hitbox da simulação); browser-extra ("entidade visível/sincronizada para o sobrevivente") |
| 42 | Compilação e inicialização | `npm run build` + todos os testes sobem o servidor real |

Observação honesta: os testes de navegador rodam com renderização por software (SwiftShader, ~15 FPS). Não houve teste em celular físico, Safari ou Firefox.

## 4. Publicação (GitHub + Render)

1. Descompacte o ZIP e, na pasta `veu/`, envie para o seu repositório: `git add -A && git commit -m "VÉU v0.2" && git push`.
2. No Render, o serviço criado pelo `render.yaml` reimplanta sozinho a cada push (ou use *Manual Deploy*). Se for a primeira vez: *New → Blueprint →* escolha o repositório.
3. Em *Environment*, o Render cria `ADMIN_TOKEN` automaticamente (anote para cadastrar códigos novos).
4. **Importante — persistência:** no plano gratuito o disco é apagado a cada reinício/deploy, então contas, níveis e códigos resgatados se perdem. Para guardar de verdade, use um plano pago com disco (descomente `disk:` e `DATA_FILE` no `render.yaml`). O adaptador PostgreSQL ainda não foi escrito (o schema está pronto).
5. O APK (PWABuilder) não precisa ser refeito: ele abre o site, que já recebe a versão nova. O service worker foi para `v2` e atualiza sozinho.

## 5. O que não foi concluído / depende de algo externo

- **Persistência no Render gratuito**: depende de disco pago ou do adaptador PostgreSQL (`PgStore`, não implementado nesta versão).
- **Modelos de artista**: a criatura e os humanos são malhas orgânicas procedurais (sem cubos) com animações procedurais; não são modelos esculpidos/riggados em Blender (não há ferramentas nem acesso à internet neste ambiente). A estrutura permite trocar por glTF depois.
- **Uma única entidade**: o pedido falava em "classes de monstros"; o jogo tem uma (O Reverberante, agora com o visual da imagem). A Tecelã e O Hiato continuam só projetadas.
- **Compensação de latência nos tiros**: continua usando a posição atual da entidade no servidor.
- **Testes em aparelhos reais** (celulares, Safari, Firefox) não foram feitos.
- `npm run typecheck` com os tipos oficiais não pôde rodar aqui (sem internet para instalar `@types`); a checagem foi feita com `tsconfig.offline.json` (sem erros).
