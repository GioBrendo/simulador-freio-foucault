# Simulador unificado — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** juntar `Projeto_COM_NUCLEO-main` (matemática principal) e as funções extras de `Projeto_bobina_nucleada_sem_circuito_magnetico-main` num simulador web, com um disco de aço galvanizado e a cena de `suporte.png`.

**Architecture:** o ponto de partida é uma cópia do COM_NUCLEO. `physics.js` ganha um modelo de material genérico com μr, revestimento e efeito pelicular. A UI recebe as extras do projeto Bobina, e `main.js` reconstrói a cena (motor, mancais, suportes em T).

**Tech Stack:** HTML + módulos ES, three@0.160.0 via importmap (jsDelivr), testes com `node --test` (Node 26), verificação no Chromium headless do ms-playwright.

**Spec:** `docs/projeto-simulador-unificado.md`

Não é um repositório git, então não há passos de commit.

## Global Constraints

- Os projetos originais não são modificados.
- Sem build e sem dependências novas no navegador. O importmap continua em `three@0.160.0`.
- Cu: resultados de `step()` idênticos ao `physics.js` original (tolerância relativa 1e-9).
- Al: mecânica dentro de 1e-3 do original. A única diferença é a condutividade térmica por material (k_Al = 237 contra o 390 implícito no original).
- Bobinas com eixo paralelo ao eixo do motor, em x = `poleX` = 2,2 un. Nunca coaxiais.
- Galvanizado: σ_Fe 7,0e6 S/m, μr 200, ρ 7850, c 470, k 50, α 0,0065; Zn com t = 20e-6 m por face, σ 1,69e7 e α 0,0042.
- Aço (`Fe`): σ 6,0e6, μr 200, ρ 7850, c 490, k 50, sem revestimento.
- Histerese: η = 1000 J/m³ (B em T), expoente 1,6.
- Toda a UI em português.

## Review Focus

1. Trocar de material com o disco girando (Galv ↔ Cu): não pode surgir NaN, e textura e mapas do disco trocam certo.
2. ω = 0 em CC com disco ferromagnético: ωₑ = 0 dá δ = ∞, e d_ef deve valer d, sem NaN.
3. Sentido reverso (`dir = -1`) com aço: o torque se opõe ao movimento e a histerese nunca inverte o giro.
4. Sliders no extremo (3000 esp., exc 8, 2400 rpm, 8 Hz) com cada material: integração estável e valores finitos.
5. URL `#...&mat=Galv` abre o galvanizado. Chave desconhecida cai para Cu.

---

### Task 1: física generalizada e testes

**Files:**
- Create: `Simulador_Freio_Foucault/` (cópia de `Projeto_COM_NUCLEO-main/index.html` e `js/*`)
- Create: `package.json` (`{"type":"module","scripts":{"test":"node --test tests/"}}`)
- Modify: `js/config.js` (materiais e bloco `phys.geo`)
- Modify: `js/physics.js`
- Test: `tests/physics.test.mjs`

**Interfaces:**
- Produces, em `config.js`:
  - `CONFIG.phys.geo = { mu0, D, gap2, poleA, poleR, aGap, kF, bSatGap }`
  - `CONFIG.phys.hyst = { eta:1000, n:1.6 }`
  - materiais `Cu`, `Al`, `Fe`, `Galv` com `{ name, sigma, rho, c, k, mur, alpha, ferro?, coat?:{t,sigma,alpha}, spangle?, color, metal, rough }`
- Produces, em `physics.js` (exports):
  - `matProps(key) → { ...m, g, bPerA, bInst, TH, KT, slip0, thermalMass, gTrack }`, memoizado por chave;
  - `sheet(mp, w, tTrack) → { G, delta, dEff }`;
  - `torqueAt(w) → N·m` (Foucault + histerese, no estado atual);
  - `wPeak(key) → rad/s` (pico da curva em CC a 20 °C);
  - `resetTemp()`;
  - campos novos em `sim`: `Th`, `delta`, `G`, `Fax`;
  - os de antes continuam: `sim, params, view, step, resetSim, turnsRatio, peakB, bOf, bRmsNow`.

- [ ] **Step 1: Copiar** o COM_NUCLEO para `Simulador_Freio_Foucault/` e copiar `Freios_Eletromagneticos.md` para `docs/`.
- [ ] **Step 2: Escrever os testes** em `tests/physics.test.mjs`. O original é importado de `../../Projeto_COM_NUCLEO-main/js/physics.js`.
  - `cu identico ao original`: mesmos `params` (900 rpm, exc 1, CA 1,2 Hz e CC, motor ligado e desligado com ω0 = 900 rpm), 600 passos de 1/120 s. `omega, Tb, P, PJ, Ptr, V, temp, tTrack, tCoil` com erro relativo < 1e-9.
  - `al proximo do original`: igual, com `omega, Tb` < 1e-3.
  - `galv: B/A maior abaixo da saturacao`: `matProps('Galv').bPerA / matProps('Cu').bPerA` ≈ 0,011/0,006025 (±1e-6).
  - `galv: delta infinito parado em CC`: `sheet(mp, 0, 20)` dá `delta === Infinity` e `dEff === D`.
  - `aco: T ∝ ω^-1/2 em alta rotacao`: com `Fe` (sem zinco), em 20000 e 80000 rad/s, a razão `torqueAt` fica entre 0,45 e 0,55.
  - `galv: zinco soma torque em alta rotacao`: `torqueAt` com Galv > com Fe a 20000 rad/s (mesmo B). O zinco domina quando δ_Fe → 0 e a queda volta a ser ~1/ω.
  - `galv: histerese positiva e so ferro`: `sim.Th > 0` com Galv e `=== 0` com Cu, após `step` com exc 1.
  - `reverso`: `dir = -1` com Galv, motor ligado, 1200 passos → `omega < 0` e `Tb*omega >= 0`.
  - `estabilidade`: para cada material, turns 3000, exc 8, 2400 rpm, f 8, CA, 2400 passos → todos os campos de `sim` finitos.
- [ ] **Step 3: Rodar** `npm test` na pasta. Esperado: FAIL (exports inexistentes).
- [ ] **Step 4: Implementar** conforme a spec, seções 1 a 8:
  - g = gap2 + D/mur;
  - bPerA = kF·μ0·2·N0·√2/g;
  - TH = tanh(π·g/(4a));
  - KT = ½·π·a²·r·TH/μ0;
  - slip = 2·TH/(μ0·G·r);
  - cb = KT·Bq²·2/(slip·(1+s²));
  - Ptr com G;
  - T_h no termo de atrito;
  - `sim.P = Tb·ω + Th·|ω|`;
  - gTrack escalado por k/390.
- [ ] **Step 5: Rodar** `npm test`. Esperado: todos passam.

### Task 2: UI — extras do projeto Bobina e o material galvanizado

**Files:**
- Modify: `index.html`
  - seção "CURVA T × ω" com `#curve` e `#curveInfo`;
  - botão `#btnResetTemp`;
  - linhas HUD `#rDel` (δ) e `#rFax` (atração axial);
  - id `#specDisc` no bloco de título; "2 × 240 esp.";
  - botão de cenário `data-scn="galv"`.
- Modify: `js/materials.js`: export `spangleTex()` (Voronoi em canvas 512², feito uma vez sob demanda).
- Modify: `js/features.js`:
  - `setMat` aplica a textura spangle (sem groove) ou restaura o groove; atualiza `#specDisc`;
  - `matInfo` com μr, k, ωc, δ(50 Hz) e g magnético;
  - cenário `galv`;
  - CSV com `delta_mm, Th_N_m, Fax_N`.
- Modify: `js/main.js`: `drawCurve()` usa `torqueAt` em 80 pontos e marca o pico; HUD de δ e Fax; botão de reset.

**Interfaces:**
- Consumes: `torqueAt`, `wPeak`, `matProps`, `resetTemp`, `sim.delta`, `sim.Fax`, `sim.Th` (Task 1).
- Produces: `spangleTex(): THREE.CanvasTexture`.

- [ ] **Step 1: Implementar** os itens acima.
- [ ] **Step 2: Verificar no navegador** (servidor `python -m http.server` e Chromium headless com `--enable-logging=stderr`). Esperado: nenhum erro de console; a curva desenha com `#mat=Galv` e com `#mat=Cu`.

### Task 3: cena no estilo de `suporte.png`

**Files:**
- Modify: `js/main.js`:
  - base longa (z de −10,6 a +4,8);
  - motor (z de −6,4 a −10, eixo em y = 0) sobre um suporte de 4 pernas;
  - acoplamento em z ≈ −5,7 dentro de `shaftGroup`;
  - eixo de z −5,4 a +4,5;
  - mancais trapezoidais extrudados em z = ±3,6, com rolamento (anel externo, 10 esferas girando a 0,4·φ, anel interno no `shaftGroup`);
  - suportes em T em x = 2,2, z = ±0,68, da base até y = −0,86;
  - `PARTS` e `ANNS` novos (motor, mancal, suporte das bobinas).
- Modify: `js/scene.js`: câmera (`camTo` ≈ (13,5; 4,5; 6), alvo (1; −1; −2,6)); sombra ±13.
- Modify: `js/features.js`: `VIEWS.overview` e a vista nova `motor`.

- [ ] **Step 1: Implementar.**
- [ ] **Step 2: Verificar no navegador:** captura de tela 1600×900 mostrando motor, mancais, suportes, bobinas e disco; nenhum erro de console.

### Task 4: textos dos cenários e verificação final

- [ ] **Step 1: Medir** os números dos cenários (emergência, regime, galvanizado) rodando `step()` em Node.
- [ ] **Step 2: Atualizar** os textos em `features.js` com esses números.
- [ ] **Step 3:** rodar `npm test` e repetir as verificações de navegador das Tasks 2 e 3.
