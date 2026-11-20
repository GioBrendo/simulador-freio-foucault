// Todos os "números mágicos" do modelo num só lugar.
// ÚNICA fonte das dimensões do disco (1 = 100 mm): Ø150 × 5 mm. Toda a geometria 3D é derivada daqui.
// Escala proporcional: polos, núcleo, bobinas, eixo e cubo acompanham o raio do disco (a cena não muda, só os mm por unidade);
// a espessura (5 mm) e os entreferros (1,5 mm/lado) são absolutos. Ø250 (projeto original) → R:1.25.
const DISC = { R:0.75, T:0.05 }, VIEW_R = 3.2;   // VIEW_R: raio do disco na cena (polos, núcleo, bobinas e mapa de calor foram desenhados p/ esse raio)
const S = VIEW_R/DISC.R;                          // unidades de cena por unidade do disco
// REF (Ø640×50) × SC só sobrevive no motor de bancada idealizado do original (motorGain/Min/Max, com phys.motorReal = false) e nos limiares de HUD.
const REF = { R:3.2, T:0.5 };
const SC  = (DISC.R*DISC.R*DISC.T)/(REF.R*REF.R*REF.T);   // = 1/65,536
const CU  = { sigma:5.80e7, rho:8960, c:385 };            // σ (S/m), ρ (kg/m³), c (J/kg·K): cobre C11000 (ETP), 100 % IACS
const DISC_HEATCAP = CU.rho*CU.c*Math.PI*(DISC.R*0.1)**2*(DISC.T*0.1);   // m·c do disco (raio e espessura em m): Ø150 ≈ 305 J/K

// ---- Circuito magnético (núcleo em C de aço-Si, 2 bobinas em série aditiva) e freio de Foucault, derivados da GEOMETRIA do desenho ----
// (espelha main.js: sapata polar r = 0,62 un.; perna r = CORE.legR; seção do braço/coluna CORE.limbT × CORE.limbW; polo em x = 2,2 un.)
const MU0 = 4e-7*Math.PI, U = DISC.R*0.1/VIEW_R, D = DISC.T*0.1;   // U: m por unidade de cena; D: espessura do disco (m)
const TURNS0 = 240, RATED_A = 6, POLE_X = 2.2;    // 240 esp./bobina × 6 A ef. = 2880 A·esp no par (revisão 3: o par de 12 A não cabia na janela)
const GAP_F  = 0.3;                               // entreferro por lado = 0,3·d = 1,5 mm (revisão 3; era 3 mm). Exige empeno axial do disco < ~0,2 mm
const G_TOT  = 2*GAP_F*D + D;                     // caminho sem ferro: 2 entreferros + disco (μr≈1) = 8 mm; o ferro (μr≫1) quase não entra. Disco ferromagnético: 2g₀ + d/μr (physics.matProps)
const POLE_A = 0.62*U, POLE_R = POLE_X*U;         // raio da sapata (m) e raio do eixo do polo (m)
const A_GAP  = Math.PI*POLE_A**2;                 // área da face polar (Ø150: a = 14,5 mm → ≈ 663 mm²)

// ---- Núcleo e bobinas em unidades de cena (main.js desenha daqui; a física tira as seções, os caminhos e a janela) ----
// Revisão 3: o braço de 0,4 un. (209 mm²) e a perna Ø0,84 un. (304 mm²) eram menores que a face polar (663 mm²) e saturavam com B ≈ 0,45 T
// no entreferro; a bobina de 12 A precisava de 960 mm² de janela e o desenho tinha ~55 mm².
const WIRE = { a:1.65e-6, name:'AWG 15 (Ø1,45 mm)' }, K_FILL = 0.6;   // fio esmaltado classe F; k_f: enchimento da janela
const CORE0 = { legR:0.5, shoeR:0.62, shoeT:0.16, limbT:0.7, limbW:1.0, colX0:1.75, coilRi:0.55, coilRo:1.25, flange:0.05 };
const A_WIN  = TURNS0*WIRE.a/K_FILL;                                   // janela por bobina (m²) = N·A_fio/k_f ≈ 660 mm²
const COIL_H = A_WIN/((CORE0.coilRo - CORE0.coilRi)*U*U);              // comprimento axial do enrolamento (un.) que fecha a janela
const CORE = { ...CORE0, coilH:COIL_H, legL:COIL_H + 0.19, flangeR:CORE0.coilRo + 0.03 };   // perna: flange (0,065) + enrolamento + flange + folga (0,075)
const DY_V = 0.55 - (DISC.T*S/2 + GAP_F*DISC.T*S);                     // deslocamento axial da cena (main.js: DY)
const Y_FACE = 0.55 - DY_V;                                             // face polar (un., a partir do plano médio do disco)
const Y_ARM0 = Y_FACE + CORE.shoeT + CORE.legL;                         // face interna do braço (un.)
const Z_COIL = Y_FACE + CORE.shoeT + 0.065 + 0.025 + COIL_H/2;          // centro axial da bobina (un.)

const A_LIMB = 0.95*(CORE.limbT*U)*(CORE.limbW*U);   // seção líquida do braço/coluna (empilhamento 0,95) ≈ 365 mm²
const K_F = 0.9, BSAT_FE = 1.6;                   // K_F: fuga + franjamento do modelo ORIGINAL (phys.fringe = false); BSAT_FE: assíntota da curva tanh do aço-Si (T)
const B_PER_A   = K_F*MU0*2*TURNS0*Math.SQRT2/G_TOT;   // (original) B pico no entreferro por A ef. (lei de Ampère: MMF = 2·N·I)
const B_SAT_GAP = K_F*BSAT_FE*A_LIMB/A_GAP;            // (original) B no entreferro em que o braço atinge BSAT_FE (Φ_gap = K_F·Φ_braço)
// Revisão 3 (phys.fringe): franjamento por permeâncias de Roters (physics.matProps), fuga entre braços e relutância do ferro:
const MU_FE  = 4000;                              // μr do aço-Si não saturado (M400-50A: 3000–6000)
const JOINT  = 0.1e-3;                            // entreferro parasita total das juntas das lâminas (2 juntas × 0,05 mm)
const L_LIMB = 2*(CORE.colX0 + CORE.limbT/2 + Y_ARM0 + CORE.limbT/2)*U;   // 2 braços (eixo do polo → centro da coluna) + coluna entre os centros dos braços (m)
const L_LEG  = 2*(CORE.shoeT + CORE.legL)*U;                           // 2 pernas + sapatas (m)
// fuga entre os braços (placas paralelas, largura limbW, separação 2·Y_ARM0): fora da bobina vê a MMF toda; sobre ela, ~1/3 (MMF cresce ao longo da bobina).
// Fica em PARALELO com a coluna (alivia o retorno, não carrega o braço) e soma à indutância.
const P_LEAK = MU0*CORE.limbW*U*((CORE.colX0 - CORE.flangeR) + (CORE.flangeR + CORE.legR + 0.08)/3)/(2*Y_ARM0);
// Freio de disco fino (Schieber): T(ω) = 2·Tmax·s/(1+s²), s = ω/ωc.
//  inclinação em baixa velocidade (robusta): c0 = ½·σ·d·B²·(π·a²)·r²   (B = valor CC-equivalente; ½ = campo circular sobre folha infinita)
//  velocidade crítica: reação das correntes = campo aplicado → vc = 2·tanh(k·g/2)/(μ0·σ·d), k = π/(2a); com ferro dos dois lados reação ≥ espaço livre (tanh<1)
//  Tmax = c0·ωc/2. Incerteza de ωc ≈ ×2 (modelo concentrado); Tmax independe de σ, ωc ∝ 1/σ.
// SLIP0 e BRAKE_K: polo geométrico e K_F (referência do original); o modelo atual usa o polo equivalente a_ef (physics.matProps).
const B_EQ  = B_PER_A*RATED_A/Math.SQRT2;                    // B eficaz equivalente em CC, nominal, sem saturar
const TH    = Math.tanh(Math.PI*G_TOT/(4*POLE_A));
const SLIP0 = 2*TH/(MU0*CU.sigma*D)/POLE_R;                  // ωc (rad/s) do Cu, polo geométrico, folha fina
const BRAKE_K = 0.5*B_EQ**2*Math.PI*POLE_A**2*POLE_R*TH/MU0; // Tmax (N·m) com Ir = 1 (excitação nominal linear), disco infinito
// ---- Correção de borda (disco finito; Wiederick et al., Am. J. Phys. 55, 500 (1987); Freios_Eletromagneticos.md §3.2b) ----
// As correntes parasitas fecham pela região entre o polo e a borda; com o polo perto da borda (r + a = 0,88·R) o torque cai:
// K_G = 1 − (a/R)²/(1 − (r/R)²)²  ≈ 0,865 com o polo geométrico (o modelo usa a_ef: ≈ 0,81)
const K_G = 1 - (POLE_A/(DISC.R*0.1))**2/(1 - (POLE_R/(DISC.R*0.1))**2)**2;
// ---- Sem circuito magnético: 2 núcleos polares (perna + sapata) SEM culatra; o fluxo volta pelo ar ----
// Relutância do retorno pelo ar ≈ N_d·L/(μ0·A_perna) (fator de desmagnetização da haste L = 2·l_núcleo + g; physics.rExt)
const R_LEG = CORE.legR*U, A_LEG = Math.PI*R_LEG**2, L_CORE = (CORE.shoeT + CORE.legL)*U;   // raio e área da perna, comprimento do núcleo (sapata + perna) (m)
// ---- Grandezas derivadas da GEOMETRIA do disco: inércia, trilha, bobina, transformador ----
const R_M = DISC.R*0.1, M_DISC = CU.rho*Math.PI*R_M*R_M*D, A_DISC = 2*Math.PI*R_M*(R_M + D);   // raio (m), massa (kg), área de troca: 2 faces + borda (m²)
const J_DISC = 0.5*M_DISC*R_M*R_M;                        // kg·m²: disco (½mR²)
const J_HUB  = 7e-4*(R_M/0.125)**5;                        // cubo, colares e eixo de aço (7e-4 kg·m² no Ø250; escala proporcional → ∝ R⁵)
const J_MOTOR = 4.5e-4;                                    // rotor do motor acoplado (IEC 71, 0,55 kW, 2 polos, típico) + acoplamento. AJUSTE ao catálogo do motor real
const TRACK_FRAC = 4*POLE_R*POLE_A/(R_M*R_M);             // fração da massa no anel varrido sob os polos (r ± a) ≈ 0,53
const G_TRACK = 390*D*2*Math.PI*POLE_R/POLE_A;            // condução radial anel → resto do disco (k_Cu = 390 W/m·K) ≈ 44 W/K
// ---- Bobina REAL (revisão 3): janela = N·A_fio/k_f, espira média da janela, troca térmica pela superfície externa ----
const C_RI = CORE.coilRi*U, C_RO = CORE.coilRo*U, C_H = COIL_H*U, C_RM = (C_RI + C_RO)/2;
const LM = Math.PI*(CORE.coilRi + CORE.coilRo)*U;          // espira média (m)
const A_EXT = 2*(2*Math.PI*C_RO*C_H + Math.PI*(C_RO**2 - C_RI**2));   // 2 bobinas: cilindro externo + o equivalente a 1 face (as faces encostam na sapata e no braço) (m²)
const H_COIL = 14;                                         // W/m²·K: convecção natural + radiação do esmalte (ε ≈ 0,9) com ΔT ≈ 80 K; condução para o núcleo desprezada (conservador)
const COIL = { R20:1.72e-8*2*TURNS0*LM/WIRE.a, alpha:0.00393, C:1.1*385*CU.rho*2*TURNS0*LM*WIRE.a, G:H_COIL*A_EXT, hCoil:H_COIL, aExt:A_EXT,
  aWire:WIRE.a, wire:WIRE.name, kFill:K_FILL, aWin:A_WIN, lm:LM,
  Lair:2*MU0*TURNS0**2*Math.PI*C_RM**2/(C_H + 0.9*C_RM),   // L com o núcleo saturado (bobinas "a ar", Wheeler): piso da L incremental
  vBus:24, tauReg:1e-3 };   // fonte CC regulada em corrente com 24 V de complacência (força a subida); τ_reg: malha de corrente. vBus = R·I emula fonte de tensão "seca"
// Bobina do desenho ANTIGO (referência do COM_NUCLEO, phys.fringe = false): espira média de 89 mm, 5 A/mm², L com K_F, G = 1,5 W/K
const WIRE_A0 = RATED_A/5e6, LT = 2*Math.PI*0.605*U;
const COIL_ORIG = { R20:1.72e-8*2*TURNS0*LT/WIRE_A0, alpha:0.0039, C:1.1*385*CU.rho*2*TURNS0*LT*WIRE_A0, G:1.5,
  L0:4*MU0*TURNS0**2*A_GAP*K_F/G_TOT };
// ---- Motor real (revisão 3, phys.motorReal): indução 0,55 kW, 2 polos, 2850 rpm, com inversor V/f ----
// perto do síncrono o torque é linear no escorregamento: T = T_n·(ω_s − ω)/(ω_s − ω_n); o inversor limita a ±1,5·T_n
const MOTOR = { Pn:550, nN:2850, nS:3000 };
MOTOR.Tn = MOTOR.Pn/(MOTOR.nN*Math.PI/30); MOTOR.gain = MOTOR.Tn/((MOTOR.nS - MOTOR.nN)*Math.PI/30);
MOTOR.max = 1.5*MOTOR.Tn; MOTOR.min = -1.5*MOTOR.Tn;
const CABLE_Y = -(CORE.coilRo - 0.05), CABLE_Z = Z_COIL;   // cabos saem da base de cada bobina
export const CONFIG = {
  disc:{ ...DISC, Rv:VIEW_R, Tv:DISC.T*S, gap:GAP_F*DISC.T*S, gapF:GAP_F, mm:DISC.R*100/VIEW_R },   // Rv/Tv: raio/espessura na cena; gap: entreferro por lado (0,3·T = 1,5 mm p/ 5 mm); mm: mm por unidade de cena
  core:CORE,                          // núcleo e bobinas em unidades de cena (main.js)
  poleX:POLE_X,                       // raio do eixo dos polos (mundo, +x)
  overlayOffset:0.004,             // afastamento entre planos E / B (anti z-fighting)
  cables:[
    [[2.7,CABLE_Y,CABLE_Z],[3.0,CABLE_Y - 0.45,CABLE_Z + 0.7],[2.9,-3.6,Math.max(2.9, CABLE_Z + 1.4)],[2.6,-4.5,3.3]],
    [[2.7,CABLE_Y,-CABLE_Z],[3.2,CABLE_Y - 0.45,-CABLE_Z - 0.7],[3.4,-3.4,-1.5],[3.5,-4.4,1.2],[4.2,-4.5,3.3]]
  ],
  feedBoxX:[2.6,4.2],
  phys:{ bPerA:B_PER_A, bSat:B_SAT_GAP, trackFrac:TRACK_FRAC, turns0:TURNS0, ratedA:RATED_A, slip0:SLIP0, heatFrac:1.0, ambient:28,
         // bPerA/bSat: modelo ORIGINAL (K_F). Com phys.fringe (padrão) physics.matProps recalcula B/A, tetos de saturação e polo equivalente.
         // brakeK/slip0: físicos (acima, bloco do freio). Abaixo: inércia, atrito (rolamentos + windage Cm·ρ·R⁵·ω²), convecção (physics.hConv, + radiação), condução na trilha, transformador (trP, trS) e bobina (R, L, C, G) vêm da geometria
         gTrack:G_TRACK, motorGain:30*SC, motorMin:-90*SC, motorMax:400*SC, brakeK:BRAKE_K,   // motor idealizado do original (phys.motorReal = false)
         motor:MOTOR,
         lossA:0.003, lossB:5e-5, lossC:0.006*1.2*R_M**5, area:A_DISC, eps:0.4,   // eps: emissividade única do original (phys.matEps = false); o modelo atual usa a de cada material
         h0:6, h1:0.11,                    // convecção linear do original (só com hDisc:false); o modelo atual é physics.hConv
         air:{ k:0.027, nu:1.7e-5 },       // ar a ~40 °C (filme): condutividade (W/m·K) e viscosidade cinemática (m²/s)
         inertiaDisc:J_DISC, inertiaHub:J_HUB, motorJ:J_MOTOR,   // J total = disco + cubo/eixo + rotor do motor (o motor fica acoplado mesmo desligado)
         edgeCorr:true,                                         // aplica K_G (disco finito) ao torque de Foucault
         expStep:true,                                          // integra o amortecimento pela solução exponencial exata (false: Euler semi-implícito do original)
         acInst:true,                                           // CA: torque instantâneo ∝ B(t)² na dinâmica e histerese por <|B|ⁿ> (false: torque médio do original)
         ptrDisc:true,                                          // perda de transformador com as correntes que fecham fora do polo e <Ḃ²> (false: só sob o polo)
         hDisc:true,                                            // convecção de disco girante laminar + natural (false: h = h0 + h1·ω)
         yokeAir:true,                                          // núcleo em C: culatra saturada em paralelo com o retorno pelo ar + limite das pernas (false: teto fixo da culatra, original)
         // revisão 3 (auditoria): cada correção tem chave; o teste de igualdade com o COM_NUCLEO desliga todas
         fringe:true,                                           // franjamento (Roters) + fuga + ferro no lugar de K_F; torque com polo equivalente a_ef = a·√F
         bhCurve:true,                                          // saturação pela curva B-H do aço-Si (balanço de MMF) no lugar do tanh (só com fringe)
         // aço-Si M400-50A: pontos de 1,53/1,63/1,73 T a 2500/5000/10000 A/m = mínimos da EN 10106 (conservador); abaixo de 1,5 T, curva típica de catálogo.
         // CONFIRME com a folha de dados do fornecedor. Acima de 1,9 T: inclinação μ0.
         bh:{ B:[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.53, 1.63, 1.73, 1.8, 1.9],
              H:[0,  35,  50,  60,  68,  76,  85,  95, 107, 121, 140, 165, 205, 290, 500, 1150, 2500, 5000, 10000, 16000, 30000] },
         coilDyn:true,                                          // bobina com fonte: di/dt = (V − R·i)/L_inc(i) (false: corrente imposta)
         skinAll:true,                                          // efeito pelicular também em Cu/Al (false: só no disco ferromagnético)
         leverArm:true,                                         // braço de alavanca do polo finito: r² → r² + a²/2
         matEps:true,                                           // emissividade por material (false: eps = 0,4 para todos)
         motorReal:true,                                        // motor de 0,55 kW com inversor (false: motor idealizado REF × SC)
         trP:Math.PI*D*POLE_A**4/8, trS:MU0*D*POLE_A/(2*TH), coil:COIL, coilOrig:COIL_ORIG, thermalMass:DISC_HEATCAP,
         scale:SC,   // fator SC exposto p/ limiares de torque/potência no HUD e no osciloscópio
         // geometria crua p/ o modelo por material e por circuito (physics.matProps): μ0, espessura d, 2 entreferros, raio da sapata a, raio do polo r,
         // A_gap, K_F, B_sat no entreferro (original), K_G, raio do disco, perna (raio, área), comprimento do núcleo, B_sat do aço-Si,
         // seção e comprimento do braço, comprimento das pernas, μr do aço-Si, juntas, permeância de fuga, espessura da sapata
         geo:{ mu0:MU0, D, gap2:2*GAP_F*D, poleA:POLE_A, poleR:POLE_R, aGap:A_GAP, kF:K_F, bSatGap:B_SAT_GAP, kG:K_G, RM:R_M,
               rLeg:R_LEG, aLeg:A_LEG, lCore:L_CORE, bSatFe:BSAT_FE,
               aLimb:A_LIMB, lLimb:L_LIMB, lLeg:L_LEG, murFe:MU_FE, joint:JOINT, pLeak:P_LEAK, shoeT:CORE.shoeT*U },
         hyst:{ eta:1000, n:1.6 } },   // histerese de Steinmetz no disco ferromagnético: W_h = η·B^n (J/m³ por ciclo, B em T), η ≈ 1 kJ/m³ p/ aço baixo carbono (limite superior: em CC o laço é menor, unipolar)
  sim:{ dt:1/120, maxSteps:12, maxFrame:0.1 },   // passo fixo + acumulador
  hudEvery:0.12,
  heat:{ tau:3.0, lift:0.007, trackDT:100, tMax:400 },   // trackDT: sobreelevação didática da trilha; tMax: fim da escala do mapa (°C)
  materials:{   // σ (S/m), ρ (kg/m³), c (J/kg·K), k (W/m·K), μr, ε (emissividade da face usinada); Cu é a referência do modelo
    Cu:  { name:'Cobre',    ...CU, k:390, mur:1, alpha:0.0039, eps:0.1, color:0xc97a3f, metal:1.0,  rough:0.30 },   // C11000; ε: usinado, levemente oxidado (polido 0,03; oxidado 0,6)
    Al:  { name:'Alumínio 1050', sigma:3.5e7, alpha:0.0040, rho:2700, c:897, k:229, mur:1, eps:0.08, color:0xbcc3ca, metal:1.0,  rough:0.35 },
    // 6061-T6 (chapa comum): 43 % IACS. α por Matthiessen: dρ/dT igual ao do Al puro → α·ρ constante → α = 0,0040·(2,5/3,5) ≈ 0,0029
    Al6061:{ name:'Alumínio 6061-T6', sigma:2.5e7, alpha:0.0029, rho:2700, c:896, k:167, mur:1, eps:0.1, color:0xb4bbc2, metal:1.0, rough:0.38 },
    // Ferromagnéticos (Freios_Eletromagneticos.md §1.2 e §4.1): o disco entra no circuito magnético (g = 2g₀ + d/μr) e o efeito pelicular
    // limita a espessura útil (δ = √(2/ωₑμσ)). μr EFETIVO: estimativa típica de aço de baixo carbono parcialmente saturado (faixa 10²–10³).
    Fe:  { name:'Aço',      sigma:6.0e6, alpha:0.0065, rho:7850, c:490, k:50, mur:200, eps:0.3, ferro:true, color:0x6f757c, metal:0.85, rough:0.50 },
    // Aço galvanizado: substrato DC01 + zinco por imersão a quente Z275 (275 g/m² nas 2 faces ≈ 20 µm/face). Zn não magnético, δ_Zn ≫ t → folha em paralelo.
    Galv:{ name:'Aço galvanizado', sigma:7.0e6, alpha:0.0065, rho:7850, c:470, k:50, mur:200, eps:0.25, ferro:true,
           coat:{ name:'Zn', t:20e-6, sigma:1.69e7, alpha:0.0042 }, spangle:true, color:0xd4d9de, metal:0.85, rough:0.52 }
  },
  shadow:{ high:2048, low:512 },
  bloom:{ strength:0.55, radius:0.6, threshold:1.0, fieldGain:1.7, discGain:2.4 }
};
