# Plano de desenvolvimento e situação das etapas

Legenda: ✅ concluído e testado · 🟡 parcial · ⬜ não iniciado

## Etapa 1 — Fundação ✅
- ✅ Estrutura do projeto, build (esbuild), TypeScript estrito
- ✅ Identidade visual (logotipo, paleta, fundo cinematográfico, tipografia)
- ✅ Tela inicial, navegação entre 13 telas, notificações
- ✅ Configurações persistentes (gráficos, controles, áudio, voz)

## Etapa 2 — Jogabilidade ✅
- ✅ Personagem sobrevivente (modelo procedural personalizável)
- ✅ Movimento, corrida com fôlego, agachar, colisão com o grid
- ✅ Câmera 1ª/3ª pessoa com colisão
- ✅ Ambiente 3D, iluminação dinâmica por zona, lanternas, neblina
- ✅ Interações (portas, armários, itens, consoles), vida, ferimento, queda, resgate, morte, espectador

## Etapa 3 — Entidade ✅ (1 de 3)
- ✅ Modelo original do Reverberante com animações procedurais
- ✅ Ataque, perseguição, visão especial, camuflagem, evolução
- ✅ Rastro, Eco Falso (Eco Biológico), Ruptura, Parasita
- ⬜ Tecelã e Hiato (projetados em DESIGN.md)

## Etapa 4 — Multiplayer ✅
- ✅ Servidor autoritativo a 30 Hz, salas, códigos, lista pública, partida rápida
- ✅ Sincronização com predição/reconciliação e interpolação
- ✅ Distribuição de funções, partidas completas, reconexão
- ✅ Voz WebRTC por proximidade
- 🟡 Escala horizontal (uma instância atende várias salas; múltiplas instâncias exigem roteamento — ver ARQUITETURA)

## Etapa 5 — Missões ✅
- ✅ 7 tipos de objetivo, 3 fases sorteadas, itens e portas de segurança
- ✅ Condições de vitória/derrota e colapso por tempo

## Etapa 5b — Armas e suprimentos ✅
- ✅ Pistola, fuzil e lança-chamas com dano, cadência, recarga e combustível próprio (servidor)
- ✅ Entidade com integridade, regeneração e queimadura; destruição = vitória dos sobreviventes
- ✅ Caixas de munição e galões com coleta animada, limite por jogador, antiduplicação e reposição pelo servidor
- ⬜ Compensação de latência nos tiros

## Etapa 6 — Conteúdo 🟡
- ✅ Complexo Abissal
- ⬜ Setor Helix, Estação Ártica (projetados)
- ✅ Personalização (36 cosméticos), loja, inventário
- ✅ Progressão: níveis, conquistas, temporada, maestria, histórico, estatísticas

## Etapa 6b — Atualização "Prompt Master" (v0.2) ✅
- ✅ XP com teto no nível 50 (curva progressiva), bônus de participação/vitória/fuga/MVP
- ✅ Ranking online, amigos (pedidos, presença, convites, notificações), perfil e histórico de recompensas
- ✅ Melhorias permanentes de humano e monstro com efeito real no servidor
- ✅ Código de presente PARAENSE01 + administração de códigos (ADMIN_TOKEN)
- ✅ Combate reequilibrado (18% por golpe comum, Golpe Brutal especial, regra dos dois golpes testada)
- ✅ Portas automáticas, estamina aprimorada, iluminação com verificação de cobertura em todas as células
- ✅ Minimapa e assistência de mira
- ✅ Nova criatura (imagem de referência) e humanos com malhas orgânicas e animações
- ✅ Schema PostgreSQL ampliado (14 tabelas) com restrições contra duplicação/manipulação

## Etapa 7 — Finalização 🟡
- ✅ Testes automatizados: 62 unitários, 64 de contas/social, 32 de combate/portas/estamina, 33 de armas/suprimentos, 56 de partida com bots, 49 no navegador
- ✅ Segurança básica (ver ARQUITETURA)
- 🟡 Compatibilidade: testado no Chrome (desktop e modo de toque emulado); falta testar Firefox, Safari e celulares reais
- ⬜ PgStore (adaptador PostgreSQL), HTTPS/TURN de produção, monitoramento
- ⬜ Otimização: instanciamento de geometria dinâmica, pool de matrizes nos modelos, LOD de luzes

## Próximas prioridades sugeridas
1. `PgStore` (o plano gratuito do Render apaga o arquivo de dados ao reiniciar; com PostgreSQL ou disco pago o progresso fica permanente).
2. Testes de jogo com pessoas reais para calibrar o balanceamento (valores em `shared/constants.ts` e `shared/upgrades.ts`).
3. Modelos esculpidos/riggados por artista (glTF) substituindo as malhas procedurais em `client/src/game/characters.ts`.
4. Segunda entidade (A Tecelã) e Setor Helix, reaproveitando `MapBuilder` e a estrutura de habilidades.
5. Bots de preenchimento (a navegação dos testes já serve de base).
