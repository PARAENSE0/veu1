# VÉU: Ecos da Ruptura — Documento de Game Design

> Legenda: **[implementado]** = funciona na versão 0.1 e tem teste automatizado. **[projetado]** = desenho fechado, ainda sem código.

## 1. Premissa

Em 2041, o consórcio Abissal mantinha laboratórios em lugares onde ninguém ouviria um grito: o fundo do oceano, uma ilha de pesquisa biológica e o gelo polar. Nos três, cientistas estudavam a **Ruptura** — fissuras por onde vazam organismos que não obedecem às regras da biologia. Os sobreviventes são técnicos e pesquisadores presos quando as contenções falharam. As entidades não são monstros "de raça": cada uma é um fenômeno diferente da Ruptura, com sua própria lógica.

## 2. Regras da partida [implementado]

- 2 a 9 jogadores: 1 entidade e até 8 sobreviventes. O servidor sorteia a entidade entre quem a prefere (depois "qualquer"), priorizando quem foi entidade menos vezes na sala.
- Duração máxima: 15 min. Ao esgotar, o complexo colapsa e todos os sobreviventes restantes morrem.
- **Vitória dos sobreviventes**: pelo menos metade (arredondada para cima) escapa. Caso contrário vence a entidade. Se a entidade abandonar ou ficar desconectada por 60 s, os sobreviventes vencem.
- Fases de objetivos (sorteadas a cada partida, inclusive locais dos itens e quais estações ficam ativas):
  1. Duas tarefas entre: **Restaurar a energia** (fusíveis → painel do gerador), **Coletar amostras biológicas** (→ analisador), **Recuperar documentos secretos** (→ terminal de arquivo), **Ativar transmissores** (3 de 7 possíveis, 8 s cada).
  2. Uma tarefa entre: **Reativar comunicações** (2 de 3 consoles, 12 s cada) ou **Encontrar cartões de acesso** (→ painel de segurança).
  3. **Preparar a evacuação**: a porta de segurança de uma das duas docas (sorteada) abre; canalizar 20 s na cápsula; depois basta entrar na área de fuga.
- A quantidade de itens escala com o número de sobreviventes (2 a 4). Canalizar junto acelera (1 + 0,5 por ajudante, máx. 2×).
- Se "Restaurar a energia" não for sorteada, os geradores de reserva acendem as luzes ao início da fase 2.

## 3. Sobreviventes [implementado]

| Atributo | Valor |
|---|---|
| Vida | 100 (golpe da entidade = 50; ferido ≤ 50) |
| Andar / correr / agachado / rastejando | 3,4 / 5,5 / 1,7 / 0,75 m/s |
| Fôlego | 100; correr gasta 21/s; recupera 15/s após 1 s; ao zerar fica exausto até 30 |
| Caído | sangra por 60 s (pausa enquanto alguém resgata); resgate de 4 s volta com 40 de vida |
| Adrenalina | +30% de velocidade por 2 s após ser atingido |
| Inventário | 4 espaços |

Itens de apoio sorteados no mapa: **Kit médico** (cura 50 em 4 s, imóvel), **Detector de ressonância** (3 cargas; mostra a posição aproximada da entidade a ±5 m a todos os sobreviventes, interrompe a camuflagem por 3 s e marca ecos falsos num raio de 18 m), **Sinalizador** (luz por 25 s; anula a camuflagem a até 7 m).

Esconderijos: 20 armários. Escondido, o sobrevivente some da visão da entidade, mas após 20 s o coração acelera e gera sinais de ruído a cada 3 s. A entidade pode vasculhar armários: encontrar alguém causa um golpe; errar a deixa atordoada 1,2 s.

Ruído percebido pela entidade (através das paredes, com imprecisão): correr (a cada 1,2 s, ±1,5 m), canalizar objetivos (a cada 3 s, ±3 m), abrir/fechar portas, estar ferido, ficar muito tempo no armário.

Espectador: ao morrer ou fugir, a câmera segue os sobreviventes vivos (clique alterna).

## 3.1 Armas e suprimentos [implementado]

Todo sobrevivente carrega três armas (nomes originais). Todo disparo, dano, recarga e coleta é decidido pelo servidor.

| Arma | Dano | Cadência | Pente | Recarga | Alcance | Reserva máx. | Começa com |
|---|---|---|---|---|---|---|---|
| Pistola P-50 "Âncora" | 40 por tiro | 1 a cada 0,38 s (semiautomática) | 8 | 1,5 s | 32 m | 32 | 8 + 8 |
| Fuzil FR-9 "Maré" | 15 por tiro | 10/s (automático) | 30 | 2,3 s | 40 m | 90 | vazio |
| Lança-chamas LC-3 "Fornalha" | 60/s + queimadura 12/s por 3 s | contínuo | — | — | 6,5 m, cone de 36° | 100 de combustível | vazio |

- Tiros são instantâneos, calculados no servidor contra o corpo da entidade (cilindro de 0,55 m × 2,6 m), com desvio aleatório; paredes, portas fechadas, chão e teto bloqueiam.
- Não é possível atirar correndo, escondido, caído, curando ou coletando. Atirar interrompe a operação de consoles.
- **Cada disparo faz barulho**: a entidade recebe um sinal de ruído, então atirar revela a posição.
- O lança-chamas usa só combustível; não compartilha munição com as outras armas.
- Pente vazio recarrega sozinho se houver reserva; sem nada, a arma dá um clique vazio.

**Entidade destrutível.** Integridade = 600 + 300 por sobrevivente (900 com 1, 1.800 com 4, 3.000 com 8). Regenera 12/s depois de 6 s sem sofrer dano (queimadura conta como dano). Ser atingida quebra a camuflagem. Se chegar a zero, **os sobreviventes vencem** — quem deu o golpe final ganha +500 pontos e todos os sobreviventes vivos +200; cada 10 de dano vale 1 ponto.

**Suprimentos.** Caixas de munição de pistola (+12), de fuzil (+30) e galões de combustível (+35), sorteados com pesos 45%/35%/20%.
- Surgem só em 20 pontos definidos: corredores, túneis, contenção e algumas salas — nunca nas docas de fuga.
- Ficam ativas ao mesmo tempo no máximo 2 + nº de sobreviventes caixas (4 com 2 jogadores, 10 com 8).
- Coletar leva 0,8 s (a tampa abre, o personagem se abaixa, há som e partículas) e pode ser interrompido.
- Uma caixa só pode ser coletada por uma pessoa por vez: o servidor a reserva para quem começou; se o limite do jogador for atingido, o que sobrar fica na caixa.
- Cada caixa esvaziada é reposta pelo servidor depois de 90 s, num ponto livre a pelo menos 15 m de qualquer sobrevivente.

## 4. Entidades

### 4.1 O REVERBERANTE [implementado]

**História.** Coletado como "anomalia acústica" a 2.400 m de profundidade, o espécime 7-C não tinha olhos: tinha uma membrana vertical que vibrava ao menor som. Nos registros, os pesquisadores relatam ouvir colegas chamando por eles em corredores vazios — semanas antes da fuga.

**Aparência e anatomia.** 2,6 m, digitígrado, coluna segmentada em três câmaras ressonantes com frestas luminosas que pulsam com o som; a "cabeça" é uma membrana oval com anéis concêntricos; dois braços longos terminando em lâminas, dois bracinhos dobrados no peito, três tentáculos dorsais. Animações procedurais próprias: andar, espreitar (corpo baixo), preparação e golpe com a lâmina, cabeça inclinada no Rastro, membrana vibrando no Eco, corpo projetado na Ruptura, tentáculos estendidos no Parasita, translucidez na camuflagem.

**Mecânica original — Eco Biológico.** O Reverberante só imita o que ouviu nos últimos 90 s: passos (sobrevivente correndo a até 25 m), porta (aberta/fechada por sobrevivente a até 30 m), rádio (transmissor/console operado a até 40 m), alarme (qualquer objetivo concluído) e **presença** (ao ver um sobrevivente a até 20 m, grava sua aparência e pode projetar uma silhueta falsa dele). Os ecos falsos são sutilmente desafinados (faixa que se sobrepõe à dos sons reais, então não são 100% identificáveis de ouvido), a presença falsa não tem nome nem lanterna, e o Detector os expõe.

| Habilidade | Tecla | Recarga | Duração | Efeito | Limitações |
|---|---|---|---|---|---|
| Ataque | Botão esq. | 1,6 s (acerto) / 0,9 s (erro) | preparação 0,35 s | alcance 2,4 m, arco de 110°, precisa de linha de visão | ao acertar fica 45% mais lento por 1,6 s |
| RASTRO | Q | 22 s | 7 s | mostra o caminho dos últimos 12 s dos sobreviventes a até 45 m | agachados não deixam rastro |
| ECO FALSO | R | 16 s | 3 s | som gravado no ponto mirado (até 28 m) ou silhueta falsa | só sons ouvidos nos últimos 90 s; Detector denuncia |
| RUPTURA | Espaço | 24 s | 2,2 s | 1,9× velocidade | não ataca durante; 0,9 s a 60% depois |
| PARASITA | F | 30 s | 9 s | raio de 12 m: trava consoles (pausa o progresso), apaga as luzes da zona, trava portas por 6 s, faz lanternas falharem por 3 s | não afeta cápsula já preparada |

**Visão especial.** Enxerga no escuro (ambiente claro, tons frios) e vê sobreviventes destacados em tons quentes; recebe os sinais de ruído como ondas visíveis através das paredes.

**Camuflagem.** Parado ou espreitando (≤ 1,9 m/s) por 2 s, fica quase invisível. Atacar, correr, usar Ruptura, luz de sinalizador ou Detector quebram a camuflagem. Para os sobreviventes, a entidade só é enviada pelo servidor quando há linha de visão ou a até 14 m (ouvida).

**Evolução — Ressonância.** Ganha pontos ao golpear (+1), derrubar (+1), eliminar (+2) e quando os sobreviventes concluem objetivos (+1, mecanismo de recuperação). Nível 2 (4 pts): recargas −15%. Nível 3 (9 pts): recargas −25% e +4% de velocidade.

**Contra as armas:** os disparos denunciam o atirador, a munição é escassa, Ruptura fecha distâncias rápido e a regeneração pune quem atira e foge. A Ressonância não aumenta a integridade.

**Pontos fortes:** informação e engano; ótima contra equipes que se separam e correm muito. **Pontos fracos:** velocidade base (4,85 m/s) menor que a corrida dos sobreviventes; vulnerável a equipes que andam agachadas e usam o Detector. **Estratégia:** usar Parasita nos consoles mais disputados, Eco Falso para afastar o grupo do objetivo, e Rastro para achar quem se separou.

### 4.2 A TECELÃ [projetado — mapa Setor Helix]

**História.** Um experimento de "tecido neural cultivado" que aprendeu a crescer em fios. Ocupa a instalação como uma rede: o corpo visível é só o nó que se move.

**Aparência e anatomia.** Massa central baixa e larga sustentada por seis pernas finas e articuladas; filamentos esbranquiçados que se arrastam e se fixam nas paredes; nenhum rosto, mas dezenas de pequenos nódulos que brilham quando um fio é tocado.

**Como muda o jogo:** controle de área e armadilhas, em vez de perseguição.

| Habilidade | Ideia | Limitação |
|---|---|---|
| Fio Sensível | coloca até 6 fios em portas e corredores; quem passa é revelado por 4 s e fica lento | fios são visíveis à lanterna e se rompem com sinalizador |
| Esporos | nuvem de 6 m que reduz a visão e encolhe o alcance da voz por proximidade | dura 8 s; recarga longa |
| Casulo | em vez de eliminar, envolve o caído num casulo: resgate leva o dobro do tempo, mas libera com vida cheia | só um casulo ativo por vez |
| Rede Viva | teleporta para qualquer fio próprio | 2 s de canalização visível e audível |

**Fortes:** prever rotas e punir grupos espalhados. **Fracos:** a mais lenta (4,4 m/s), golpe de alcance curto, depende de preparação. **Estratégia:** cercar os objetivos da fase 2 com fios e usar Rede Viva para responder aos alarmes.

### 4.3 O HIATO [projetado — mapa Estação Ártica]

**História.** Um intervalo de tempo que se descolou do resto. Os relógios da estação congelaram em horários diferentes; os sobreviventes relatam ver a mesma pessoa duas vezes no mesmo instante.

**Aparência e anatomia.** Silhueta humanoide alongada e incompleta — partes do corpo "atrasadas" em relação ao resto, como quadros de vídeo perdidos; cristais de gelo suspensos ao redor; deixa um rastro de geada.

**Como muda o jogo:** mobilidade e emboscada, manipulando a posição dos sobreviventes.

| Habilidade | Ideia | Limitação |
|---|---|---|
| Lapso | fica intangível e invisível por 4 s, atravessa portas | não ataca; deixa geada visível; não funciona em zonas aquecidas (geradores ligados) |
| Retrocesso | puxa um sobrevivente de volta à posição que ele ocupava 3 s antes | precisa de linha de visão; recarga de 35 s |
| Marca Futura | deixa uma marca e, 6 s depois, reaparece nela | a marca emite um zumbido audível |
| Frio | aura de 8 m que reduz a regeneração de fôlego | desligada durante o Lapso |

**Fortes:** imprevisível, ótimo em mapas abertos. **Fracos:** perde poder com a energia restaurada (calor), aura denuncia a aproximação. **Estratégia:** atacar antes da restauração de energia e usar Retrocesso perto das saídas.

## 5. Mapas

### 5.1 COMPLEXO ABISSAL [implementado]

92 × 68 m, grid de 2 m. Áreas: Alojamentos (beliches, armários), Refeitório (mesas, balcão), Enfermaria (leitos, armários médicos), Sala de Energia (quatro geradores, painel), Centro de Controle (mesas de operação, consoles, painel de segurança, terminal de arquivo), Laboratório Principal (bancadas, tanques, analisador), Túneis de Manutenção (labirinto estreito com nichos), Câmara de Contenção (tanque central, ponto de surgimento da entidade, ligada aos túneis por uma brecha), dois corredores principais e duas docas de evacuação atrás de portas de segurança. 16 portas, 20 armários, 16 estações, escotilhas com vista para o oceano, iluminação por zona (normal, emergência vermelha pulsante, apagada pelo Parasita). Rotas alternativas: cada sala tem pelo menos duas saídas; os túneis ligam o corredor sul à contenção.

### 5.2 SETOR HELIX [projetado]

Instalação de pesquisa biológica numa ilha, abandonada e tomada por vegetação. Áreas: laboratório genético, sala de experimentos, corredores de segurança, depósito, centro médico, estação de observação (dois andares com passarela). Mecânicas próprias: **portas de quarentena** que se fecham em ciclos de 40 s (mudam as rotas), **chuveiros de descontaminação** que apagam o rastro do sobrevivente, estufa com visibilidade baixa.

### 5.3 ESTAÇÃO ÁRTICA [projetado]

Estação isolada no gelo, com prédios separados por área externa. Áreas: centro de comunicação, geradores, alojamentos, garagem, laboratório, área externa. Mecânicas próprias: **tempestade de neve** periódica (visibilidade mínima e perda lenta de vida fora dos prédios), **aquecedores** como pontos seguros, **snowmobile** na garagem como saída alternativa que exige combustível.

## 6. Personalização e justiça [implementado]

Rosto, cabelo, roupa, calçado, acessório e uniforme para sobreviventes; aparências do Reverberante. Itens são puramente visuais. Para não haver vantagem competitiva, o cliente equaliza a luminância das roupas (nenhuma roupa quase preta ou quase branca) e a visão da entidade destaca todos os sobreviventes do mesmo jeito.

## 7. Progressão [implementado]

XP por partida (50 de participação + pontuação/5 + 100 pela vitória), fragmentos (◈ = XP/4), +50 ◈ por nível, 9 conquistas com bônus, temporada com 7 níveis de recompensa (moedas e cosméticos exclusivos), maestria do Reverberante (aparências exclusivas), histórico das últimas 50 partidas e estatísticas individuais. Sem pagamentos reais.

## 8. Áudio [implementado]

Todo o áudio é sintetizado em tempo real (Web Audio): passos por superfície e estado, portas metálicas, rádio com fala ininteligível, alarmes, gritos, impactos, rangidos do casco, cantos distantes do oceano, zumbido de pressão, rosnado posicional da entidade, batimentos cardíacos e música de perseguição que crescem com a proximidade, estrondo de susto. Som 3D binaural (HRTF) e reverberação de casco metálico (qualidade alta), estéreo simples (qualidade baixa). A posição exata da entidade nunca é enviada sem linha de visão: o batimento usa só um nível de "ameaça".

## 9. Atualização v0.2 — progressão, social e combate [implementado]

### 9.1 Combate (servidor decide tudo)
| Ataque | Dano (vida humana = 100) | Observações |
|---|---|---|
| Golpe comum (botão esquerdo) | **18** (18%) | preparação 0,35 s; recarga 1,25 s ao acertar; um único alvo por golpe; exige linha de visão e alcance 2,4 m |
| Golpe Brutal (botão direito) | **34** (34%) | preparação 0,8 s (a entidade fica lenta); alcance 2,9 m; recarga 12 s |
| Poder de ataque no máximo | ×1,15 | 2 golpes comuns = 41,4 → **nunca derruba com dois golpes comuns** |
| Resistência física no máximo | ×0,85 | |

São necessários pelo menos **5 golpes comuns** (6 com o caído) para eliminar um sobrevivente sem melhorias de resistência. A adrenalina após um golpe foi reduzida (1,4 s, +20%) para não tornar fugas impossíveis de punir.

### 9.2 Melhorias permanentes (5 níveis; custos 300/700/1.200/2.000/3.000 fragmentos)
Humanos: estamina máxima (+5%/nível), recuperação de estamina (+10%), velocidade (+1%), resistência física (−3% de dano), velocidade de interação (+6%).
Monstro: velocidade (+1%), resistência (−3% do dano de armas), poder de ataque (+3%), recuperação de habilidades (−4% de recarga), eficiência das habilidades (+6% de duração).
Os valores máximos foram limitados para não quebrar o equilíbrio (ex.: velocidade no máximo = +5%).

### 9.3 Estamina
Gasta 21/s correndo; recupera 15/s depois de 1 s sem correr, **×1,6 parado** (e mais com a melhoria de recuperação); esgotada, bloqueia a corrida até 30% (aviso "EXAUSTO"); aviso "fôlego baixo" abaixo de 25%. A predição do cliente usa as mesmas regras (com as melhorias) para não haver correção visível.

### 9.4 Portas automáticas
Para humanos, portas comuns abrem quando alguém chega a 0,9 m do vão e fecham 1,5 s depois que todos se afastam — nunca com alguém no vão. A entidade não aciona o sensor (abre manualmente), portas de segurança seguem os objetivos e portas travadas pelo Parasita continuam travadas.

### 9.5 Iluminação
Toda célula andável (cômodos, corredores e vãos de porta) precisa receber luz mínima com linha de visão, com energia ligada (luzes da área) e desligada (emergência vermelha). Onde falta, o mapa ganha luzes de preenchimento mais fracas — o clima escuro se mantém. O renderizador usa as 16 luzes mais próximas por quadro.

### 9.6 Minimapa e mira
O minimapa mostra a planta real, portas, a própria posição/direção, companheiros que você já está vendo e os objetivos ativos — nunca a entidade (nem os sobreviventes no minimapa da entidade). A assistência de mira só atua com a entidade visível, sem camuflagem, dentro do alcance da arma, sem parede no caminho e dentro de um cone pequeno; não dispara sozinha. Automático: forte no toque, média no mouse.

### 9.7 Visual da entidade (imagem de referência)
Criatura alta (≈2,6 m) e muito magra, pele pálida com veias arroxeadas e escorridos de sangue, cabeça redonda e lisa com um sorriso largo de dentes, coroa de espinhos ósseos (marfim → vermelho na ponta), espinhos nos ombros e ao longo da coluna, braços longos com dedos em garra e pés de garras. Mantém todas as habilidades do Reverberante.
