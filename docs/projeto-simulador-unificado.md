# Simulador unificado — freio por correntes de Foucault

Data: 2026-11-19 · Status: aprovado

## Intenção

Um único simulador web (Three.js, sem build) que junta os dois projetos de `Projeto real`:

- `Projeto_COM_NUCLEO-main` — núcleo em C de aço-Si com saturação. **É a matemática da simulação principal.**
- `Projeto_bobina_nucleada_sem_circuito_magnetico-main` — modelo linear. Dele vêm **só as funções extras**, não a matemática.

Uso duplo: dimensionar o protótipo real da bancada e apresentar na disciplina de Conversão Eletromecânica. A física precisa ser fiel e o visual, didático.

## Metas

1. Matemática do COM_NUCLEO na simulação principal. Para Cu e Al, os resultados são **numericamente idênticos** aos do original.
2. Funções extras portadas do projeto Bobina:
   - curva T×ω (Wouterse) com o ponto de operação;
   - botão "repor temperatura";
   - profundidade de penetração δ na ficha do material;
   - condutividade térmica k por material na condução da trilha.
3. Novo material de disco: **aço galvanizado**, com física ferromagnética e camada de zinco.
4. Cena 3D no arranjo de `suporte.png`: motor à esquerda sobre suporte com pernas, eixo horizontal, mancais com rolamento, bobinas sobre suportes em T dos dois lados do disco, base.

## Não metas

- Seletor entre os dois modelos magnéticos. O usuário escolheu portar só as funções extras.
- Ferramentas de build, frameworks ou dependências novas. Continua com módulos ES e importmap do three@0.160.0.
- Alterar os projetos originais.

## Anti-metas (falharia mesmo funcionando)

- Bobinas coaxiais ao eixo, como no esboço. O campo seria axissimétrico, as correntes parasitas não fechariam laços e o torque seria nulo. As bobinas ficam com eixo **paralelo** ao eixo do motor, deslocadas 55 mm (raio dos polos, `poleX`).
- Mudar os números de Cu ou Al em relação ao COM_NUCLEO.

## Abordagens consideradas

| Abordagem | Prós | Contras | Decisão |
|---|---|---|---|
| Copiar o COM_NUCLEO e portar as extras | preserva o modelo validado; diferença pequena entre os projetos (~90 % do código é igual) | — | **escolhida** |
| Mesclar os dois `main.js` | — | duas matemáticas conflitantes no mesmo código | descartada |
| Reescrever do zero | — | perde o modelo conferido e o acabamento visual | descartada |

## Física do disco ferromagnético (aço e aço galvanizado)

Notação do COM_NUCLEO:

- a = raio da sapata polar (24,2 mm);
- r = raio do eixo do polo (85,9 mm);
- d = espessura do disco (5 mm);
- g₀ = entreferro por lado (0,6·d = 3 mm);
- k = π/(2a).

Parâmetros novos por material: `mur` (μr efetivo), `ferro` (bool) e `coat` (revestimento: espessura e σ).

### 1. Relutância: o disco entra no circuito magnético

O caminho sem ferro passa a ser g = 2g₀ + d/μr. Para Cu e Al (μr = 1), continua g = 2g₀ + d = 11 mm. Para o aço com μr = 200, fica g ≈ 6,03 mm.

    B_pico/A_ef = K_F·μ₀·2N·√2 / g

O limite de saturação B_sat,gap = K_F·B_sat,Fe·A_braço/A_gap (0,45 T) **não muda**, porque é o braço do núcleo que satura. Assim o ganho de B só aparece abaixo da saturação.

### 2. Coeficiente de torque e velocidade crítica

Mantém a forma de Schieber/Wouterse do COM_NUCLEO, com o g do material:

    TH   = tanh(k·g/2)
    Tmáx = ½·B²·π·a²·r·TH/μ₀            (B = valor eficaz equivalente após a saturação)
    ωc   = 2·TH/(μ₀·G·r)
    T(ω) = 2·Tmáx·s/(1+s²),  s = ω/ωc

G é a condutância de folha do disco (S):

- Cu e Al: G = σ·d, que reproduz exatamente o COM_NUCLEO.
- Ferromagnético: G = σ_Fe·d_ef(ω) + 2·σ_Zn·t_Zn.

### 3. Efeito pelicular (só para disco ferromagnético)

Com μr ≫ 1, δ fica menor que d e a hipótese de folha fina deixa de valer (Freios_Eletromagneticos.md §1.2 e §4.1). Para Cu e Al com d = 5 mm, δ > d em quase toda a faixa, e a folha fina continua válida. Por isso a correção só se aplica aos materiais ferromagnéticos, o que também preserva os números do COM_NUCLEO.

    ωₑ   = √((k·|ω|·r)² + (2πf)²)        (f só em CA; a frequência vista pelo material)
    δ    = √(2/(ωₑ·μ₀·μr·σ_Fe))
    d_ef = 2δ·tanh(d/(2δ))               (correntes nas duas faces; d_ef → d quando δ ≫ d)

Em alta rotação, d_ef ∝ ω^-½ e ωc ∝ ω^½, então T ∝ ω^-½. Esse é o comportamento conhecido dos rotores de aço maciço, diferente do T ∝ 1/ω dos discos de Cu e Al.

### 4. Camada de zinco (galvanizado)

Revestimento Z275: cerca de 20 µm por face, σ_Zn = 16,9 MS/m e α_Zn = 0,0042. O zinco não é magnético e tem δ_Zn ≫ t_Zn, então entra como uma folha condutora em paralelo: +2·σ_Zn·t_Zn ≈ 650 S. Isso equivale a ~2 % de G em baixa rotação e a mais quando δ_Fe encolhe em alta rotação.

### 5. Histerese

Steinmetz: W_h = η·B^1,6, com η ≈ 1 kJ/m³ para aço de baixo carbono. Cada ponto da trilha passa uma vez por volta sob o polo.

    T_h = W_h·(2a)·r·d                   (≈ mN·m: pequeno e constante com ω; Freios_Eletromagneticos.md §2.2)

T_h entra como atrito, sem inverter o sentido de giro. A potência T_h·|ω| aquece a trilha.

### 6. Perdas de transformador (CA)

As fórmulas do COM_NUCLEO usam σ·d. Para disco ferromagnético, σ·d é trocado por G. O original contava só as correntes sob o polo. A versão atual inclui as que fecham pelo disco fora dele (função de corrente com ψ = 0 na borda, função de Green do disco; exata para B uniforme no polo) e usa <Ḃ²>, que capta as harmônicas da saturação:

    P_tr = G·<Ḃ²>·(π·a⁴/8)·[1 + 4·ln((R² − r²)/(R·a))] / (1 + (ω·μ₀·G·a/(2·TH))²)

No Ø150 o colchete vale ≈ 5,0: a perda é cerca de 5× a do original. A parte sob o polo (1/5) aquece a trilha; o resto aquece o disco.

### 7. Atração axial

F = B²·A_gap/(2μ₀) por face, cerca de 53 N a 0,45 T no Ø150 (A_gap = 663 mm²; os 150 N antigos eram do Ø250). Aparece na ficha do material. As duas faces se equilibram só com o disco centrado, então isso importa para dimensionar os mancais.

### 8. Temperatura

σ_Fe(T) = σ₂₀/(1 + α·ΔT), com α_Fe = 0,0065. μr é tratado como constante, válido muito abaixo do Curie (770 °C).

### Materiais

| chave | nome | σ (MS/m) | μr | ρ | c | k | revestimento |
|---|---|---|---|---|---|---|---|
| Cu | Cobre | 59,6 | 1 | 8960 | 385 | 390 | — |
| Al | Alumínio | 35 | 1 | 2700 | 897 | 237 | — |
| Fe | Aço | 6,0 | 200 | 7850 | 490 | 50 | — |
| Galv | Aço galvanizado | 7,0 | 200 | 7850 | 470 | 50 | Zn 20 µm/face |

O "Aço" do COM_NUCLEO ignorava o ferromagnetismo (μr ≈ 1). Agora ele usa o mesmo modelo ferromagnético, sem zinco.

## Cena (suporte.png)

- **Base de fixação** longa ao longo do eixo (z), cobrindo do motor ao mancal direito.
- **Motor** à esquerda: carcaça com aletas, tampa e ventoinha, caixa de ligação e placa "MOTOR". Fica sobre um suporte de 4 pernas inclinadas, com acoplamento flexível até o eixo.
- **Dois mancais** trapezoidais com topo arredondado e rolamento de esferas visível (anel externo, esferas e anel interno girando com o eixo).
- **Disco** no centro. O aço galvanizado ganha uma textura de flor de zinco ("spangle").
- **Unidade magnética** (núcleo em C + 2 bobinas) em x = poleX, cada bobina sobre um suporte em T a partir da base. A coluna do núcleo em C é mantida.
- Câmera, sombras, anotações e tooltips ajustados à cena mais longa.

## Verificação

- Testes em Node (`node --test`) sobre `physics.js`:
  - Cu e Al passo a passo idênticos ao `physics.js` original do COM_NUCLEO;
  - aço: B/A maior abaixo da saturação; δ < d em rotação; T ∝ ω^-½ em alta rotação; T_h > 0; energia coerente.
- Navegador: página carrega sem erros de console; captura de tela da cena.

## Decisões deixadas ao implementador

- Valores de μr = 200 e η = 1 kJ/m³ são estimativas típicas para aço de baixo carbono (faixa de 10² a 10³ em Freios_Eletromagneticos.md §4.1). Ficam editáveis em `config.js`.
- Textos dos cenários: os números são recalculados com o modelo final.

---

## Revisão 2 (2026-11-19): auditoria, disco Ø150 e opção sem circuito magnético

### Disco Ø150 × 5 mm

`config.js` passa a usar `DISC.R = 0.75`. A escala é proporcional: polo, bobinas, núcleo, eixo e cubo acompanham o raio (×0,6), e a espessura (5 mm) e os entreferros (3 mm por lado) são absolutos. O eletroímã do Ø250 não cabe no Ø150, porque o polo invadiria o cubo ou a borda.

| Grandeza (Cu, núcleo em C, 12 A) | Ø250 | Ø150 |
|---|---|---|
| raio da sapata a · raio do polo r | 24,2 · 85,9 mm | 14,5 · 51,6 mm |
| TH = tanh(πg/4a) | 0,342 | 0,534 |
| ωc (Cu) | 203 rpm | 527 rpm |
| J total (disco + cubo + rotor) | — | 2,73·10⁻³ kg·m² |

### Correções da auditoria

1. **Borda do disco (disco finito).** O COM_NUCLEO supunha uma folha infinita. Com o polo perto da borda (r + a = 0,88R), as correntes fecham numa faixa estreita e o torque cai. Aplica-se K_G = 1 − (a/R)²/(1 − (r/R)²)² ≈ 0,865 ao Tmáx (Wiederick et al., Am. J. Phys. 55, 500, 1987; Freios_Eletromagneticos.md §3.2b). Resultado: −13,5 % no torque, com a mesma ωc.
2. **Inércia.** O motor desenhado fica acoplado ao eixo, então o rotor dele também precisa ser freado. J = ½MR² + J_cubo·(R/125 mm)⁵ + J_motor, com J_motor = 4,5·10⁻⁴ kg·m² (estimativa IEC 71, 0,55 kW; ajuste ao catálogo do motor real).
3. **Legenda do mapa de B.** Dizia 0,8 T, mas a escala real vai até 0,5 T. Corrigido.

### Sem circuito magnético (`params.circ = 'open'`)

Ficam só os dois núcleos polares (perna Ø0,84 un. + sapata), sem a culatra. O fluxo volta pelo ar.

    R_g  = g/(μ0·A_gap)                                   (entreferro: 2g₀ + d/μr)
    R_ar = N_d(m)·L/(μ0·A_perna),  L = 2·l_núcleo + 2g₀ + d,  m = L/(2·r_perna)
    N_d  = [m/√(m²−1)·ln(m+√(m²−1)) − 1]/(m²−1)          (esferoide prolato, Osborn 1945)
    B pico/A ef. = K_F·2N·√2/((R_g + R_ar)·A_gap)
    B_sat = K_F·B_sat,Fe·A_perna/A_gap                    (a perna satura, não o braço)
    L     = (2N)²/(R_g + R_ar)                            (sem K_F: a fuga também enlaça a bobina)

TH, ωc e Tmáx por B² não mudam, porque a reação das correntes fecha localmente entre as faces polares.

No Ø150 com Cu: R_g = 13,2 MA/Wb e R_ar = 16,9 MA/Wb, então B/A cai para 44 % e L de 17,5 para 7,7 mH. Com disco de aço, R_g cai para 7,2 MA/Wb, mas o ar continua dominando: o ganho de B é 1,25×, contra 1,83× com o núcleo em C.

### Limitações conhecidas (não alteradas)

- **Bobina.** 240 esp. × 2,4 mm² (5 A/mm²) exigem ~960 mm² de janela com fator de enchimento 0,6. O desenho tem ~55 mm², e o modelo elétrico usa a espira média do desenho, o que subestima R e a massa de cobre. No Ø150 essa bobina não cabe em volta do polo: para o protótipo, reduza a corrente nominal (fio mais fino) ou as espiras.
- **Braço do núcleo em C.** A seção do braço (0,38 un²) é menor que a da perna (0,55 un²): a culatra satura com B ≈ 0,45 T no entreferro. Acima disso o ganho por ampère cai para o do circuito aberto (o fluxo excedente volta pelo ar), e com corrente muito alta os dois modos convergem para o limite das pernas, 0,66 T. O modelo original travava o núcleo em C em 0,45 T e o deixava abaixo do circuito aberto acima de ~25 A (240 esp.), o que é fisicamente impossível; corrigido com `phys.yokeAir`.
- **Histerese.** Usa o laço completo de Steinmetz, um limite superior em CC (laço unipolar). Os valores μr = 200 e η = 1 kJ/m³ são estimativas.
- **Condutância térmica da bobina.** G = 1,5 W/K é fixa e otimista para convecção natural.
- **Modelo de circuito aberto.** N_d de elipsoide (±20 % para cilindro). O fluxo de retorno que atravessa o disco fora do polo é ignorado.

### Auditoria das fórmulas (19/11/2026)

Conferidas contra a teoria e recalculadas numericamente (Cu, núcleo em C, 12 A CC, 900 rpm):

| Fórmula | Situação |
|---|---|
| B = K_F·μ0·2N·I/g, g = 2g₀ + d/μr | correta (Ampère com ferro ideal) |
| B_sat,gap = K_F·B_sat,Fe·A_braço/A_gap | correta (conservação do fluxo) |
| c0 = ½·σ·d·B²·πa²·r² | correta (polo circular em folha infinita: o campo de cargas anula metade da FEM) |
| ωc = 2·tanh(kg/2)/(μ0·σ·d·r), k = π/2a | correta (folha fina entre duas faces de ferro) |
| T = 2·Tmáx·s/(1+s²), Tmáx = c0·ωc/2 | correta (Schieber/Wouterse) |
| K_G = 1 − (a/R)²/(1 − (r/R)²)² | correta (Wiederick et al., 1987) |
| δ = √(2/(ωₑ·μ0·μr·σ)), d_ef = 2δ·tanh(d/2δ) | correta como aproximação |
| T_h = η·Bⁿ·(2a)·r·d | correta (energia de Steinmetz por volta ÷ 2π) |
| F_ax = B²·A/(2μ0) | correta (tensor de Maxwell, por face) |
| P_tr = π·G·ω²·B²·a⁴/8 | corrigida: só valia sob o polo (ver seção 6) |
| L0 = (2N)²·μ0·A_gap·K_F/g | corrigida: sem K_F (Φ_braço = Φ_gap/K_F) |
| h = h0 + h1·ω | corrigida: disco girante laminar, h ∝ √ω |
| R ∝ N², J_disco = ½MR², J_cubo ∝ R⁵, A_trilha/A_disco = 4ra/R² | corretas |

Correção numérica: o Euler semi-implícito atrasava a frenagem em ~7 % (dt = 1/120 s contra τ_mec = J/c0 ≈ 81 ms). O passo agora usa a solução exata do amortecimento linear congelado, ω(dt) = ω∞ + (ω − ω∞)·e^(−λ·dt), com `phys.expStep` (false volta ao original).

Fórmulas novas (`physics.js`):

    t_parada = J/(2·Tmáx)·[ωc·ln(ω0/ω1) + (ω0² − ω1²)/(2·ωc)]     (stopTimeSchieber; HUD da curva usa stopTime = J·∫dω/T(ω) com atrito, histerese e ωc(ω))
    τ_mec    = J/c0,  c0 = 2·Tmáx/ωc                               (queda exponencial em baixa rotação)
    τ_e      = L/R ≈ 57 ms                                         (tauCoil; independe de N com janela fixa)

O termo ln(ω0/ω1) diverge com ω1 → 0. O freio de Foucault sozinho não leva o disco a zero nem o segura parado; quem zera é o atrito ou um freio mecânico.

Correções seguintes (mudam os resultados de referência; cada uma tem chave em `phys` e o teste de igualdade com o COM_NUCLEO desliga todas):

| Item | Antes | Agora | Chave |
|---|---|---|---|
| Perda de transformador | só sob o polo, ω²·B_ef² | inclui as correntes fora do polo e <Ḃ²> (≈ 5× sem saturar; ≈ 6× a 12 A, pelas harmônicas) | `ptrDisc` |
| Convecção | h = 6 + 0,11·ω | h = (h_nat³ + h_rot³)^⅓, h_rot = 0,36·k_ar·√(ω/ν) (Cobb & Saunders), h_nat = 1,42·(ΔT/2R)^¼ | `hDisc` |
| Indutância | L0 = 15,7 mH (×K_F) | L0 = 17,5 mH; τ_e de 51 para 57 ms | test troca `coil.L0` |
| Dinâmica em CA | torque médio | torque instantâneo ∝ B(t)², média de B² no passo; histerese por <\|B\|ⁿ> | `acInst` |
| Nome `Ipk` | guardava o valor eficaz | `Irms` | — |
| Saturação no núcleo em C | B = B_culatra·tanh(x/B_culatra): teto de 0,45 T, abaixo do circuito aberto (0,66 T) com N·I alto | culatra em paralelo com o retorno pelo ar: B_lin = ρ·x + (1 − ρ)·B_culatra·tanh(x/B_culatra), ρ = R_g/(R_g + R_ar); depois B = B_perna·tanh(B_lin/B_perna). Garante B_C ≥ B_aberto | `yokeAir` |

Em CA o HUD, a curva e o estado mostram os valores médios no ciclo (`TbM`, `ThM`, `PM`). O osciloscópio e o CSV mostram os instantâneos (`Tb`, `Th`, `P`). Com f baixa a frenagem passa a depender da fase: a 1,2 Hz, 900→90 rpm a 12 A leva 0,33 s partindo de B = 0, contra 0,37 s do modelo médio, porque a parada dura menos que um período do torque (0,42 s).

---

## Revisão 3 (2026-11-19): correções da auditoria técnica

Esta revisão corrige o projeto do eletroímã e fecha os elos que faltavam no modelo. Cada correção de modelo tem uma chave em `phys`. O teste de igualdade com o COM_NUCLEO desliga todas e roda o original com o **mesmo projeto**: entreferro, seção do braço, σ do Cu e corrente nominal.

### Projeto físico (config.js → `CONFIG.core`, desenhado pela cena)

| Grandeza | Antes | Agora | Por quê |
|---|---|---|---|
| Entreferro por lado | 3 mm (g = 11 mm) | 1,5 mm (g = 8 mm) | g/a = 0,76 dava franjamento enorme e exigia N·I alto. Exige empeno axial do disco < ~0,2 mm |
| Braço/coluna do C | 0,4 × 1,0 un. = 209 mm² | 0,7 × 1,0 un. = 365 mm² | era 3,2× menor que a face polar (663 mm²) e saturava com 0,45 T no entreferro |
| Perna | Ø19,7 mm (304 mm²) | Ø23,4 mm (431 mm²) | a perna leva o fluxo de toda a face equivalente |
| Bobinas | 240 esp. × 12 A, 2,4 mm², janela necessária de 960 mm² contra ~55 mm² desenhados | 240 esp. × 6 A, AWG 15 (1,65 mm², J = 3,6 A/mm²), janela de 660 mm² (k_f = 0,6): Ø25,8–58,6 mm × 40 mm | a bobina não cabia; agora a janela é desenhada e a física usa a espira média real (133 mm) |
| Perna (comprimento) | 19,7 mm | 44,7 mm | comporta a bobina |

### Modelo (physics.js)

| Chave | Correção | Fórmula |
|---|---|---|
| `fringe` | K_F único trocado por franjamento de Roters, ferro e fuga | F = 1 + p·[0,26 + ln(1 + 2t/g)/π]·g/(πa²), p = 2πa, t = sapata. A_ef = F·A_gap; polo equivalente a_ef = a·√F no torque, ωc, K_G, pelicular e P_tr. K_lin = 1/(1 + R_Fe/R_g), com R_Fe = Σl/(μ0·μr·A) + juntas. A fuga entre braços (P_fuga) fica em paralelo com a coluna e soma a L |
| `bhCurve` | tanh trocado pela curva B-H do aço-Si | MMF(B) = B·g/μ0 + H(B_perna)·l_perna + M_ret, com Φ = A_braço·B_culatra(M_ret) + M_ret·(1/R_ar + P_fuga). A tabela M400-50A usa os mínimos da EN 10106 (1,53/1,63/1,73 T a 2,5/5/10 kA/m); **confirmar com o fornecedor** |
| `coilDyn` | entrada elétrica dinâmica (fonte, não corrente imposta) | di/dt = (V − R(T)·i)/L_inc, L_inc = L_ar + (L_lin − L_ar)·dB/dx. Fonte CC regulada em corrente com complacência de 24 V (`coil.vBus`). Com vBus = R·I vira fonte "seca": τ = L/R ≈ 54 ms, e a parada fica >10 % mais lenta |
| `skinAll` | efeito pelicular também em Cu/Al | d/δ do Cu = 0,7 a 900 rpm e 1,15 a 2400 rpm; d_ef = 2δ·tanh(d/2δ) |
| `leverArm` | braço de alavanca do polo finito | r² → r² + a²/2 (+6 % com a_ef) |
| `matEps` | emissividade por material | Cu 0,10; Al 0,08–0,10; aço 0,30; galvanizado 0,25 (antes 0,4 para todos) |
| `motorReal` | motor real em vez do idealizado REF × SC | 0,55 kW, 2 polos, 2850 rpm: T_n = 1,84 N·m; rigidez T_n/ω_escorregamento = 0,117 N·m·s; inversor limita a ±1,5·T_n |
| — | bobina térmica | G = h·A_ext com h = 14 W/m²·K → 0,27 W/K (antes 1,5 W/K fixo). Condução para o núcleo desprezada (conservador) |
| — | atração axial | F = <B²>·A_ef/2μ0 por face. No circuito série o mesmo fluxo cruza as duas faces: a resultante é ~0 em **qualquer** posição axial, e a carga vai para os braços do C (antes a doc dizia "só com o disco centrado") |
| — | materiais | Cu C11000 com σ = 5,80 MS/m (100 % IACS). "Alumínio" virou Alumínio 1050 (k = 229). Novo Alumínio 6061-T6: σ = 25 MS/m, k = 167, α = 0,0029 (Matthiessen) |
| — | HUD | densidade de corrente no fio (vermelho > 6 A/mm²), temperatura da bobina (vermelho > 155 °C, classe F); a corrente fica vermelha quando a fonte bate em 24 V. Escala do mapa de B até 0,8 T |

### Números de referência (Cu, núcleo em C, 6 A CC, 28 °C)

| Grandeza | Valor |
|---|---|
| F (Roters) · polo equivalente · K_lin | 1,52 · Ø35,8 mm · 0,943 |
| B no entreferro (6 A) | 0,43 T (braço a ~1,2 T, trecho linear) |
| B a 12 A · 24 A | 0,68 T · 0,82 T (braço além do joelho) |
| ωc · Tmáx · T(900 rpm) · P(900 rpm) | 358 rpm · 1,08 N·m · 0,75 N·m · 71 W |
| Parada 900 → 90 rpm (motor desligado) | 0,25 s |
| L · τ = L/R · R20 · P_J | 36 mH · 54 ms · 0,66 Ω · 24 W |
| Bobina: ΔT contínuo no nominal · τ térmico | ~89 K (sem R(T)) · 25 min |
| Disco de aço galvanizado (6 A) | B 0,77 T; F_ax ≈ 200 N por face (nos braços do C) |

Com o motor real a 900 rpm de alvo, o disco de Cu gira a ~834 rpm (escorregamento sob 0,8 N·m). A 9 A (cenário de superaquecimento), a bobina passa de 155 °C em ~16 min: acima do nominal o freio é intermitente.

### Limitações que continuam

- **Franjamento e polo equivalente.** O Roters é uma estimativa (±20 %). O polo equivalente uniforme superestima ∫B²dA da franja. Calibre com FEMM 4.2 (axissimétrico) e sonda Hall no entreferro.
- **Curva B-H.** É tabela de norma/catálogo. Use a do lote comprado.
- **μr do disco de aço.** Continua fixo em 200. Com polarização CC vale o μ incremental (50–300), e o torque do aço muda ~±40 % nessa faixa.
- **K_G (Wiederick).** Derivado para s ≪ 1 e aplicado em toda a curva.
- **Histerese.** Laço completo de Steinmetz: é limite superior em CC.
- **Bobina.** h = 14 W/m²·K é conservador (ignora a condução para o núcleo). Meça a temperatura da bobina no protótipo.
