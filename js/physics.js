import { CONFIG } from './config.js';
const P = CONFIG.phys, M = CONFIG.materials, REF = M.Cu, GEO = P.geo;
export const view   = { field:true, efield:true, swirl:true, labels:true };
export const params = { rpm:900, exc:1, freq:1.2, hold:false, motor:true, mode:'ac', dir:1, mat:'Cu', turns:P.turns0, circ:'C' };   // circ: 'C' = núcleo em C (fechado) | 'open' = sem circuito magnético
const init = () => ({ t:0, theta:0, omega:0, phi:0, temp:P.ambient, tTrack:P.ambient, tCoil:P.ambient, V:0, Pel:0, PJ:0, Ptr:0, I:0, Irms:0, Ir:0, sat:1, Tb:0, P:0, eN:0, uEff:0,
  Th:0, Fax:0, delta:Infinity, G:0, TbM:0, ThM:0, PM:0, Iact:0, i2m:0, Vapp:0, Jcu:0 });
// Th: torque de histerese; Fax: atração axial por face; delta: profundidade de penetração; G: condutância de folha
// Tb/Th/P: instantâneos (CA pulsa em 2f); TbM/ThM/PM: médios no ciclo
// I: corrente instantânea na bobina; Irms: referência (exc × nominal); Iact: valor eficaz real (a fonte pode não alcançar a referência);
// Vapp: tensão aplicada pela fonte; Jcu: densidade de corrente no fio (A/mm²)
export const sim    = init();
const RMS = Object.assign([], { sum:0 });   // janela de i² por subpasso médio (valor eficaz em CA)
export function resetSim(omega0 = 0){ Object.assign(sim, init(), { omega:omega0 }); RMS.length = 0; RMS.sum = 0; }
export function resetTemp(){ sim.temp = sim.tTrack = sim.tCoil = P.ambient; }   // do projeto bobina nucleada: repõe as temperaturas sem parar o disco
export const turnsRatio = () => params.turns/P.turns0;   // B ∝ N·I
export const inertia = () => P.inertiaDisc + P.inertiaHub + P.motorJ;   // kg·m²: disco + cubo/eixo + rotor do motor acoplado

/* ============================================================ modelo por material e por circuito magnético
   Matemática do COM_NUCLEO (núcleo em C, saturação no braço, Schieber/Wouterse), generalizada:
   - relutância do entreferro: caminho sem ferro g = 2g₀ + d/μr (Cu/Al: 2g₀ + d = 8 mm); R_g = g/(μ0·A)
   - revisão 3 (P.fringe): A = A_ef = F·A_gap, F de Roters (franjamento); ferro (μr, juntas) e fuga entre braços (P_fuga) entram no circuito:
       núcleo em C: B pico/A ef. = K_lin·μ0·2N·√2/g, K_lin = 1/(1 + R_Fe/R_g); teto do braço B·(A_ef + P_fuga·g/μ0) = B_sat·A_braço
       sem circuito: B pico/A ef. = 2N·√2/((R_g + R_ar)·A_ef); teto da perna B·A_ef = B_sat·A_perna
     sem P.fringe: K_F único (original): B pico/A ef. = K_F·μ0·2N·√2/g; tetos K_F·B_sat·A/A_gap
   - torque: polo equivalente uniforme de raio a_ef = a·√F (mesmo fluxo e mesma permeância do polo real com franja)
     TH = tanh(k·g/2), k = π/(2a_ef); Tmáx = KT·B², KT = ½·π·a_ef²·r·TH/μ0·K_G·(1 + a_ef²/2r²); ωc = 2·TH/(μ0·G·r), G = condutância de folha (S)
     (a reação das correntes fecha localmente entre as faces polares de ferro → TH e ωc iguais com e sem culatra) */
// fator de desmagnetização (magnetométrico) de um esferoide com razão de aspecto m = comprimento/diâmetro (Osborn, 1945); aproxima a haste núcleo–entreferro–núcleo
export function demag(m){
  if (Math.abs(m - 1) < 1e-6) return 1/3;
  if (m > 1){ const q = Math.sqrt(m*m - 1); return (m/q*Math.log(m + q) - 1)/(m*m - 1); }
  const q = Math.sqrt(1 - m*m); return (1 - m/q*Math.acos(m))/(1 - m*m);
}
// relutância do retorno pelo ar (A/Wb): haste de comprimento L = 2·l_núcleo + entreferro físico, raio da perna
function rExt(){
  const L = 2*GEO.lCore + GEO.gap2 + GEO.D;
  return demag(L/(2*GEO.rLeg))*L/(GEO.mu0*GEO.aLeg);
}
// Franjamento entre 2 faces polares circulares (Roters, "Electromagnetic Devices", 1941): além do tubo central μ0·πa²/g,
// meio-cilindro na borda (0,26·μ0·perímetro) + meia-coroa pela lateral da sapata (μ0·perímetro/π·ln(1 + 2t/g)). F = permeância total/central.
export function fringe(g){
  const a = GEO.poleA, p = 2*Math.PI*a;
  return 1 + p*(0.26 + Math.log(1 + 2*GEO.shoeT/g)/Math.PI)*g/(Math.PI*a*a);
}
// circuito magnético com franjamento, ferro e fuga (P.fringe) para um caminho sem ferro g
// Topologia (núcleo em C): fonte (bobinas nas pernas) → pernas → entreferro (com franja) → retorno = culatra ∥ fuga entre braços ∥ ar (R_ar).
// A fuga entre braços e o ar ficam em paralelo com a coluna: aliviam o retorno; braço e perna levam o fluxo da face equivalente.
function circuit(g, open){
  const mu0 = GEO.mu0, F = fringe(g), Aef = F*GEO.aGap, Rg = g/(mu0*Aef), Rx = rExt();
  const RFe = (GEO.lLimb/GEO.aLimb + GEO.lLeg/GEO.aLeg)/(mu0*GEO.murFe) + GEO.joint/(mu0*GEO.aLimb);
  const kLin = 1/(1 + RFe/Rg), bC = kLin*mu0*2*P.turns0*Math.SQRT2/g, bO = 2*P.turns0*Math.SQRT2/((Rg + Rx)*Aef);
  const bLeg = GEO.bSatFe*GEO.aLeg/Aef;
  return { F, aE:GEO.poleA*Math.sqrt(F), Aef, Rg, Rx:open ? Rx : 0, RxAir:Rx, kLin, bPerA:open ? bO : bC, bLeg,
    bSat:open ? bLeg : GEO.bSatFe*GEO.aLimb/Aef,                       // B no entreferro em que o braço (C) ou a perna (aberto) chega a B_sat
    rho:bO/bC,                                                         // inclinação que sobra quando a culatra satura = a do circuito aberto
    perm:open ? 1/(Rg + Rx) : 1/(Rg + RFe) + GEO.pLeak };              // permeância vista por 2N espiras (H): L = (2N)²·perm
}
// ---- curva B-H do aço-Si (P.bhCurve): H(B) por interpolação linear da tabela; acima dela, inclinação μ0 ----
const BH = P.bh;
export function hFe(B){
  const b = Math.abs(B), n = BH.B.length - 1;
  if (b >= BH.B[n]) return Math.sign(B)*(BH.H[n] + (b - BH.B[n])/GEO.mu0);
  let lo = 0, hi = n;
  while (hi - lo > 1){ const m = (lo + hi) >> 1; if (BH.B[m] <= b) lo = m; else hi = m; }
  return Math.sign(B)*(BH.H[lo] + (BH.H[hi] - BH.H[lo])*(b - BH.B[lo])/(BH.B[hi] - BH.B[lo]));
}
// culatra com juntas: H(B)·l_braço + B·junta/μ0 = M → B (bisseção; monótona)
function bYoke(M){
  let lo = 0, hi = BH.B[BH.B.length - 1] + GEO.mu0*M/GEO.lLimb + 0.1;
  for (let i = 0; i < 50; i++){ const m = (lo + hi)/2; if (hFe(m)*GEO.lLimb + m*GEO.joint/GEO.mu0 < M) lo = m; else hi = m; }
  return (lo + hi)/2;
}
// MMF (A·esp, par de bobinas) que produz B no entreferro (centro do polo = média no polo equivalente):
//   aberto: B·g/μ0 + H(B_perna)·l_perna + Φ·R_ar
//   C:      B·g/μ0 + H(B_perna)·l_perna + M_ret,  com  Φ = A_braço·B_culatra(M_ret) + M_ret·(1/R_ar + P_fuga)
export function mmfOf(B, mp){
  const b = Math.abs(B), phi = b*mp.Aef, base = b*mp.g/GEO.mu0 + hFe(phi/GEO.aLeg)*GEO.lLeg;
  if (mp.circ === 'open') return Math.sign(B)*(base + phi*mp.RxAir);
  const yAir = 1/mp.RxAir + GEO.pLeak;
  let lo = 0, hi = phi/yAir;
  for (let i = 0; i < 50; i++){ const m = (lo + hi)/2; if (GEO.aLimb*bYoke(m) + m*yAir < phi) lo = m; else hi = m; }
  return Math.sign(B)*(base + (lo + hi)/2);
}
// tabela x → B (x = B linear do circuito = MMF·bInst/2N0), montada uma vez por material e circuito
function bhTable(mp){
  if (mp._bt) return mp._bt;
  const xs = [0], bs = [0], k = mp.bInst/(2*P.turns0);
  for (let B = 0.005; xs[xs.length - 1] < 200; B += B < 2.5 ? 0.005 : 0.05){ bs.push(B); xs.push(mmfOf(B, mp)*k); }
  return mp._bt = { x:Float64Array.from(xs), b:Float64Array.from(bs) };
}
function bhAt(x, mp){   // { b, s }: B e dB/dx (trecho linear da tabela)
  const t = bhTable(mp), a = Math.abs(x), n = t.x.length - 1;
  let lo = 0, hi = n;
  if (a >= t.x[n]) lo = n - 1, hi = n;
  else while (hi - lo > 1){ const m = (lo + hi) >> 1; if (t.x[m] <= a) lo = m; else hi = m; }
  const s = (t.b[hi] - t.b[lo])/(t.x[hi] - t.x[lo]);
  return { b:Math.sign(x)*(t.b[lo] + s*(a - t.x[lo])), s };
}
const MP = {};
const flags = () => `${+P.edgeCorr}${+P.fringe}${+P.leverArm}${+P.matEps}${+P.bhCurve}`;
export function matProps(key = params.mat, circ = params.circ){
  if (!M[key]) key = 'Cu';
  const open = circ === 'open', id = `${key}|${open ? 'open' : 'C'}|${flags()}`;
  if (MP[id]) return MP[id];
  const m = M[key], g = GEO.gap2 + GEO.D/m.mur, r = GEO.poleR;
  let c;
  if (P.fringe){
    c = circuit(g, open);
    c.lScale = c.perm/circuit(GEO.gap2 + GEO.D, false).perm;           // L relativo ao núcleo em C com disco não magnético
  } else {   // original: K_F único, polo geométrico
    const Rg = g/(GEO.mu0*GEO.aGap), Rx = open ? rExt() : 0, Rg0 = (GEO.gap2 + GEO.D)/(GEO.mu0*GEO.aGap);
    c = { F:1, aE:GEO.poleA, Rg, Rx, kLin:1,
      bPerA:open ? GEO.kF*2*P.turns0*Math.SQRT2/((Rg + Rx)*GEO.aGap)   // B de pico (T) por A ef.; por ampere instantâneo vale bPerA/√2
                 : GEO.kF*GEO.mu0*2*P.turns0*Math.SQRT2/g,
      bSat:open ? GEO.kF*GEO.bSatFe*GEO.aLeg/GEO.aGap : P.bSat,        // C: a culatra (braço) satura primeiro; aberto: a perna
      bLeg:GEO.kF*GEO.bSatFe*GEO.aLeg/GEO.aGap,                        // limite das pernas no entreferro (existem nos dois modos)
      rho:Rg/(Rg + rExt()),                                            // ρ = R_g/(R_g + R_ar): fração da inclinação que sobra quando a culatra satura
      lScale:open ? Rg0/(Rg + Rx) : (GEO.gap2 + GEO.D)/g };            // L ∝ 1/relutância total (referência: núcleo em C com disco não magnético)
    c.perm = NaN;
  }
  const aE = c.aE, TH = Math.tanh(Math.PI*g/(4*aE));
  const kG = !P.fringe ? GEO.kG : 1 - (aE/GEO.RM)**2/(1 - (r/GEO.RM)**2)**2;   // borda (Wiederick) com o polo equivalente
  return MP[id] = { ...m, ...c, key, circ:open ? 'open' : 'C', g, TH, bInst:c.bPerA/Math.SQRT2,
    KT:0.5*Math.PI*aE**2*r*TH/GEO.mu0*(P.edgeCorr ? kG : 1)*(P.leverArm ? 1 + aE**2/(2*r*r) : 1),   // braço de alavanca: ∫ρ²dA = πa²(r² + a²/2)
    slip0:2*TH/(GEO.mu0*m.sigma*GEO.D*r),                     // ωc a 20 °C sem efeito pelicular (rad/s)
    kw:Math.PI/(2*aE),                                        // número de onda do campo sob o polo (pelicular)
    ptrOut:4*Math.log((GEO.RM**2 - r**2)/(GEO.RM*aE)),        // perda de transformador fora do polo ÷ sob o polo
    eps:P.matEps ? m.eps : P.eps,                             // emissividade das faces
    thermalMass:P.thermalMass*(m.rho*m.c)/(REF.rho*REF.c),  // mesmo volume de disco
    gTrack:P.gTrack*m.k/REF.k };                            // condução trilha → disco ∝ k (projeto bobina nucleada)
}
// indutância linear (núcleo não saturado) com turns0 espiras por bobina (H)
export const lLin = (mp = matProps()) => P.fringe ? 4*P.turns0**2*mp.perm : (P.coil.L0 ?? P.coilOrig.L0)*mp.lScale;

// Condutância de folha G (S) e profundidade de penetração δ (m), com σ(T) = σ20/(1+α·ΔT).
// ωₑ = √((k·|ω|·r)² + (2πf)²) é a frequência vista pelo material; d_ef = 2δ·tanh(d/2δ) (correntes nas 2 faces);
// zinco (δ_Zn ≫ t) soma 2·σZn·tZn em paralelo. Revisão 3 (P.skinAll): vale também para Cu/Al (d/δ = 0,7 a 900 rpm e 1,15 a 2400 rpm no Cu);
// sem ela, Cu/Al ficam em folha fina (G = σ·d), como no COM_NUCLEO.
const fNow = () => params.mode === 'ac' ? params.freq : 0;
export function sheet(mp, w, tTrack, fAC = fNow()){
  const dT = tTrack - 20, sg = mp.sigma/(1 + mp.alpha*dT);
  const we = Math.hypot(mp.kw*Math.abs(w)*GEO.poleR, 2*Math.PI*fAC);
  const delta = we > 0 ? Math.sqrt(2/(we*GEO.mu0*mp.mur*sg)) : Infinity;
  if (!mp.ferro && !P.skinAll) return { G:sg*GEO.D, delta, dEff:GEO.D, sigma:sg };
  const dEff = Number.isFinite(delta) ? 2*delta*Math.tanh(GEO.D/(2*delta)) : GEO.D, c = mp.coat;
  return { G:sg*dEff + (c ? 2*c.sigma/(1 + c.alpha*dT)*c.t : 0), delta, dEff, sigma:sg };
}
// T(ω) = 2·Tmáx·s/(1+s²), s = ω/ωc(ω): escrito como Tb = cb·ω (amortecimento cb ≥ 0, ímpar em ω: Lenz). cb ∝ B²
function eddy(mp, w, Bq, tTrack, fAC){
  const sh = sheet(mp, w, tTrack, fAC), slip = 2*mp.TH/(GEO.mu0*sh.G*GEO.poleR), s = w/slip;
  return { ...sh, slip, cb:mp.KT*Bq*Bq*2/(slip*(1 + s*s)) };
}
// histerese (Steinmetz, Freios_Eletromagneticos.md §2.2): cada ponto da trilha passa 1×/volta sob o polo → T_h = η·<|B|ⁿ>·(2a)·r·d, constante com ω
const hyst = (mp, bn) => mp.ferro ? P.hyst.eta*bn*2*mp.aE*GEO.poleR*GEO.D : 0;

// Saturação do núcleo, PONTUAL (a corrente instantânea satura, não o valor eficaz). x = B linear (ferro ideal) do circuito escolhido.
// Sem circuito: B = B_perna·tanh(x/B_perna).
// Núcleo em C (P.yokeAir): a culatra fica EM PARALELO com o mesmo retorno pelo ar do modo sem circuito (R_ar). Até saturar, ela
// curto-circuita R_ar (B = x); saturada, o fluxo excedente volta pelo ar com a inclinação do circuito aberto, ρ·x, ρ = (B/A aberto)/(B/A em C):
//   B_lin = ρ·x + (1 − ρ)·B_culatra·tanh(x/B_culatra),   B = B_perna·tanh(B_lin/B_perna)   (as pernas limitam nos dois modos)
// Assim B_C(i) ≥ B_aberto(i) para qualquer i: acrescentar ferro nunca reduz o fluxo. P.yokeAir = false: B = B_culatra·tanh(x/B_culatra)
// (original), que travava o núcleo em C abaixo do circuito aberto com N·I alto.
// Revisão 3 (P.bhCurve, com P.fringe): no lugar do tanh, B sai do balanço de MMF com a curva B-H do aço-Si (mmfOf, tabela por material).
const yokeAir = mp => mp.circ === 'C' && P.yokeAir;
const useBH = () => P.fringe && P.bhCurve;
function bx(x, mp){
  if (useBH()) return bhAt(x, mp).b;
  if (!yokeAir(mp)) return mp.bSat*Math.tanh(x/mp.bSat);
  return mp.bLeg*Math.tanh((mp.rho*x + (1 - mp.rho)*mp.bSat*Math.tanh(x/mp.bSat))/mp.bLeg);
}
function dbx(x, mp){   // dB/dx
  if (useBH()) return bhAt(x, mp).s;
  const sy = 1/Math.cosh(x/mp.bSat);
  if (!yokeAir(mp)) return sy*sy;
  const sl = 1/Math.cosh((mp.rho*x + (1 - mp.rho)*mp.bSat*Math.tanh(x/mp.bSat))/mp.bLeg);
  return sl*sl*(mp.rho + (1 - mp.rho)*sy*sy);
}
export const bOf = (i, mp = matProps()) => bx(mp.bInst*i*turnsRatio(), mp);
export const peakB = () => Math.abs(bOf(P.coilDyn && params.mode === 'dc' ? sim.I : sim.Irms*(params.mode === 'ac' ? Math.SQRT2 : 1)));
// Estatística de B(t) num ciclo. CA: quadratura; com saturação pontual B(t) = bx(X·sen θ) não é senoidal.
//   b2 = <B²>         → torque de Foucault médio (T ∝ B²)
//   bn = <|B|ⁿ>       → histerese média (n de Steinmetz); difere de B_ef^n
//   d2 = <(dB/dθ)²>   → perda de transformador ∝ ω²·d2 (as harmônicas da saturação pesam com k²)
// CC: constante e d2 = 0.
const NQ = 48;
function bStats(irms, mp = matProps()){
  const nH = P.hyst.n;
  if (params.mode !== 'ac'){ const b = Math.abs(bOf(irms, mp)); return { b2:b*b, bn:b**nH, d2:0 }; }
  const X = mp.bInst*turnsRatio()*Math.SQRT2*irms;   // amplitude de B linear
  let b2 = 0, bn = 0, d2 = 0;
  for (let n = 0; n < NQ; n++){
    const th = 2*Math.PI*(n + 0.5)/NQ, x = X*Math.sin(th), b = bx(x, mp), db = dbx(x, mp)*X*Math.cos(th);
    b2 += b*b; bn += Math.abs(b)**nH; d2 += db*db;
  }
  return { b2:b2/NQ, bn:bn/NQ, d2:d2/NQ };
}
export const bRmsNow = () => Math.sqrt(bStats(P.coilDyn && params.mode === 'dc' ? Math.abs(sim.I) : sim.Irms).b2);
// <|B|ⁿ> da histerese média; P.acInst = false repete o original (B_ef^n)
const bnOf = st => P.acInst ? st.bn : st.b2**(P.hyst.n/2);

// torque MÉDIO de frenagem (Foucault + histerese) que o disco teria à velocidade w, no estado atual (corrente, temperatura, modo)
export function torqueAt(w, Bq = bRmsNow(), bn = Bq**P.hyst.n){
  const mp = matProps();
  return eddy(mp, w, Bq, sim.tTrack, fNow()).cb*Math.abs(w) + (w !== 0 ? hyst(mp, bn) : 0);
}
// velocidade do pico de torque (s = 1): resolve ω = ωc(ω) por bisseção em escala log (ωc varia com ω quando há efeito pelicular)
function peakOf(mp, tTrack, fAC){
  const slipAt = w => 2*mp.TH/(GEO.mu0*sheet(mp, w, tTrack, fAC).G*GEO.poleR);
  if (!mp.ferro && !P.skinAll) return slipAt(0);
  let lo = 1e-6, hi = 1e7;
  for (let i = 0; i < 80; i++){ const mid = Math.sqrt(lo*hi); if (mid < slipAt(mid)) lo = mid; else hi = mid; }
  return Math.sqrt(lo*hi);
}
export const wPeak = key => peakOf(matProps(key), 20, 0);   // CC, 20 °C: ficha do material
export function curveNow(){
  const mp = matProps(), st = bStats(P.coilDyn && params.mode === 'dc' ? Math.abs(sim.I) : sim.Irms, mp), Bq = Math.sqrt(st.b2), bn = bnOf(st);
  return { wc:peakOf(mp, sim.tTrack, fNow()), tmax:mp.KT*st.b2, th:hyst(mp, bn), Bq, bn };
}

// Tempo de parada (motor desligado) de ω0 até ω1, com B, σ(T) e modo congelados.
// Curva de Schieber: 1/T = ωc/(2·Tmáx·ω) + ω/(2·Tmáx·ωc)  ⇒  t = J/(2·Tmáx)·[ωc·ln(ω0/ω1) + (ω0² − ω1²)/(2·ωc)]
// O termo ln diverge com ω1 → 0: o freio de Foucault não leva o disco a zero nem o segura parado (T ∝ ω em baixa rotação);
// quem zera a rotação é o atrito ou um freio mecânico. Em baixa rotação a queda é exponencial, τ_mec = J/c0, c0 = 2·Tmáx/ωc.
export const stopTimeSchieber = (J, tmax, wc, w0, w1) => J/(2*tmax)*(wc*Math.log(w0/w1) + (w0*w0 - w1*w1)/(2*wc));
// Caso geral (ωc(ω) com pelicular, histerese e atrito): t = J·∫ dω/T(ω), integrado em u = ln ω por Simpson. Campo já estabelecido.
export function stopTime(w0, w1, Bq = bRmsNow(), bn = Bq**P.hyst.n){
  const J = inertia(), n = 200, a = Math.log(w1), h = (Math.log(w0) - a)/n;
  const f = u => { const w = Math.exp(u); return J*w/(torqueAt(w, Bq, bn) + P.lossA + P.lossB*w + P.lossC*w*w); };
  let s = f(a) + f(a + n*h);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2)*f(a + i*h);
  return s*h/3;
}
// Constante de tempo elétrica da excitação τ = L/R (N² se cancela: L ∝ N² e R ∝ N² com janela fixa).
// Com fonte de tensão "seca" (V = R·I) a corrente sobe com 1 − e^(−t/τ); a fonte regulada (P.coil.vBus) força a subida (P.coilDyn em step).
export const tauCoil = (mp = matProps(), sat = 1, tCoil = 20) => lLin(mp)*sat/(P.coil.R20*(1 + P.coil.alpha*(tCoil - 20)));

const SB = 5.670374e-8;
// Perda de transformador (campo pulsante) numa folha de condutância G, sob polo circular (raio a, centro a r do eixo), disco de raio R.
// Função de corrente ψ (K = ∇ψ × ẑ): ∇²ψ = G·Ḃ no polo e ψ = 0 na borda (a corrente não sai do disco); P = ∫K²/G dA = −Ḃ·∫polo ψ dA.
// Com a função de Green do disco e o teorema do valor médio (exato para B uniforme no polo):
//   P = G·<Ḃ²>·(π·a⁴/8)·[1 + 4·ln((R² − r²)/(R·a))]      (a: polo equivalente a_ef)
// O "1" é a parte sob o polo (única no original); o resto vem das correntes que fecham pelo disco fora dele.
// Reação das correntes (blindagem): ÷(1 + (ω·μ0·G·a/2TH)²). P.ptrDisc = false: só a parte sob o polo, com <Ḃ²> = ω²·B_ef² (original).
// Convecção nas faces do disco (h em W/m²·K):
//   girando, regime laminar (Cobb & Saunders, 1956): Nu = h·R/k = 0,36·Re^½, Re = ω·R²/ν < 2,4·10⁵ (≈ 6500 rpm no Ø150)
//     ⇒ h_rot = 0,36·k_ar·√(ω/ν), independente de R
//   parado, placa vertical laminar (ar): h_nat = 1,42·(ΔT/L)^¼, L = 2R
//   combinação de Churchill–Usagi: h = (h_nat³ + h_rot³)^⅓. Radiação à parte. P.hDisc = false: h = h0 + h1·ω (original).
export function hConv(w, dT){
  if (!P.hDisc) return P.h0 + P.h1*Math.abs(w);
  const hr = 0.36*P.air.k*Math.sqrt(Math.abs(w)/P.air.nu), hn = 1.42*Math.sqrt(Math.sqrt(Math.max(0, dT)/(2*GEO.RM)));
  return Math.cbrt(hn**3 + hr**3);
}
// convecção + radiação linearizada das faces do disco à temperatura T (°C): ε do material (P.matEps) ou 0,4 (original)
export function hTotal(mp, w, T){
  const Tm = T + 273.15, Ta = P.ambient + 273.15;
  return hConv(w, T - P.ambient) + mp.eps*SB*(Tm*Tm + Ta*Ta)*(Tm + Ta);
}
const NSUB = 16;   // subpassos da bobina (dt/16 ≈ 0,5 ms < τ_reg)
export function step(dt){
  const mp = matProps(), d = params.dir, k = turnsRatio(), C = P.coil, fAC = fNow(), ac = params.mode === 'ac', nH = P.hyst.n;
  sim.uEff = params.hold ? Math.max(1, params.exc) : params.exc;
  sim.t += dt;
  const th0 = sim.theta, dth = 2*Math.PI*params.freq*dt;
  sim.theta = (sim.theta + dth) % (2*Math.PI);   // fase acumulada: sem salto ao mudar f
  const Irms = P.ratedA*sim.uEff;                // valor eficaz de referência (em CC, a própria corrente)
  sim.Irms = Irms;
  const st = bStats(Irms, mp), Bq = Math.sqrt(st.b2), x = sim.uEff*k, Ir = Bq/(mp.bInst*P.ratedA);   // Ir: excitação efetiva após saturação, em unidades de N·I nominal
  sim.Ir = Ir; sim.sat = x > 1e-6 ? Ir/x : 1;
  const om = 2*Math.PI*params.freq, Rc = C.R20*(1 + C.alpha*(sim.tCoil - 20))*k*k, Ll = lLin(mp)*k*k;
  // B² e |B|ⁿ que agem NESTE passo
  let b2 = st.b2, bn = bnOf(st), i2 = Irms*Irms;
  if (P.coilDyn){
    // Bobina com fonte (revisão 3): fonte CC regulada em corrente, com complacência ±vBus e malha de corrente τ_reg:
    //   V = sat_vBus(R·i + L_inc·(di_ref/dt + (i_ref − i)/τ_reg)),   di/dt = (V − R·i)/L_inc,   L_inc = L_ar + (L_lin − L_ar)·dB/dx
    // Com folga de tensão a corrente segue a referência (CA incluída); sem folga (vBus = R·I) vira o degrau RL, τ = L/R.
    // Média de B(t)² e |B(t)|ⁿ nos subpassos: o torque acompanha o campo que de fato existe.
    const h = dt/NSUB, La = C.Lair*k*k, Ipk = Math.SQRT2*Irms, ref = sim.uEff > 0;
    let i = sim.I, V = 0; b2 = bn = i2 = 0;
    for (let j = 1; j <= NSUB; j++){
      const th = th0 + dth*j/NSUB, ir = !ref ? 0 : ac ? Ipk*Math.sin(th) : Irms, dr = ref && ac ? Ipk*om*Math.cos(th) : 0;
      const Li = La + (Ll - La)*dbx(mp.bInst*k*i, mp);
      V = Math.max(-C.vBus, Math.min(C.vBus, Rc*i + Li*(dr + (ir - i)/C.tauReg)));
      i += h*(V - Rc*i)/Li;
      const b = Math.abs(bOf(i, mp)); b2 += b*b/NSUB; bn += b**nH/NSUB; i2 += i*i/NSUB;
    }
    sim.I = i; sim.Vapp = V;
    // valor eficaz em CA: média de i² na janela do último período (1/f)
    const nW = Math.max(1, Math.round(1/(params.freq*dt)));
    RMS.push(i2); RMS.sum += i2; while (RMS.length > nW){ RMS.sum -= RMS.shift(); }
    sim.i2m = Math.max(0, RMS.sum/RMS.length);
    sim.Iact = ac ? Math.sqrt(sim.i2m) : Math.abs(i);
  } else {
    sim.I = sim.uEff > 0 ? (ac ? Irms*Math.SQRT2*Math.sin(sim.theta) : Irms) : 0;
    sim.Iact = Irms;
    // CA com P.acInst: média de B(θ)² em [θ0, θ0 + Δθ]; o torque pulsa em 2f e zera 2×/ciclo.
    // Quase-estático: as correntes no disco respondem com τ ≈ μ0·G·a/2TH ≈ 5 ms ≪ 1/2f. Sem acInst: média do ciclo (original).
    if (ac && P.acInst){
      b2 = bn = 0;
      for (let j = 0; j < 4; j++){ const b = Math.abs(bOf(Math.SQRT2*Irms*Math.sin(th0 + dth*(j + 0.5)/4), mp)); b2 += b*b/4; bn += b**nH/4; }
    }
  }
  const dynDC = P.coilDyn && !ac;   // CC com bobina dinâmica: o "médio" é o próprio valor do passo
  const w = sim.omega, wT = params.rpm*Math.PI/30, mg = P.motorReal ? P.motor.gain : P.motorGain;
  const mMin = P.motorReal ? P.motor.min : P.motorMin, mMax = P.motorReal ? P.motor.max : P.motorMax, raw = mg*(wT - d*w);
  const free = raw > mMin && raw < mMax;   // dentro dos limites o motor age como amortecedor linear (escorregamento do motor de indução)
  const Fm = params.motor ? (free ? d*mg*wT : d*(raw <= mMin ? mMin : mMax)) : 0, cm = params.motor && free ? mg : 0;
  const ed = eddy(mp, w, 1, sim.tTrack, fAC), cb = ed.cb*b2;   // cb por T² × B² do passo; σ(T): trilha quente → ωc maior
  sim.delta = ed.delta; sim.G = ed.G;
  // Amortecimento linear congelado no passo: solução exata ω(dt) = ω∞ + (ω − ω∞)·e^(−λ·dt), λ = (cb + cm)/J, ω∞ = Fm/(cb + cm).
  // Estável para qualquer brakeK e sem o atraso do Euler implícito (≈ 7 % a mais no tempo de parada com dt = 1/120 s).
  // P.expStep = false volta ao Euler semi-implícito do COM_NUCLEO.
  const J = inertia(), lam = (cb + cm)/J, wInf = lam > 0 ? Fm/(J*lam) : 0;
  const w1 = !P.expStep ? (w + dt*Fm/J)/(1 + dt*lam)
           : lam*dt > 1e-12 ? wInf + (w - wInf)*Math.exp(-lam*dt) : w + dt*Fm/J;
  const b2M = dynDC ? b2 : st.b2, bnM = dynDC ? bn : bnOf(st);
  sim.Tb  = cb*w1;                 // instantâneo (CA: pulsa em 2f)
  sim.TbM = ed.cb*b2M*w1;          // médio no ciclo, à velocidade atual (HUD e curva)
  const Th = hyst(mp, bn); sim.Th = Th; sim.ThM = hyst(mp, bnM);
  // Atração axial média por face sobre o disco ferromagnético: <B²>·A_ef/2μ0 (polo equivalente). Circuito série: o MESMO fluxo cruza as 2 faces,
  // então as 2 forças são iguais e opostas em QUALQUER posição axial do disco (1ª ordem): a resultante nos mancais é ~0, e cada face puxa a sua
  // sapata: a carga vai para os braços do C, que tendem a fechar o entreferro.
  sim.Fax = mp.ferro ? b2M*mp.F*GEO.aGap/(2*GEO.mu0) : 0;
  const aw = Math.abs(w), fr = (P.lossA + P.lossB*aw + P.lossC*aw*aw + Th)/J*dt;   // atrito e histerese nunca invertem o sentido
  sim.omega = Math.sign(w1)*Math.max(0, Math.abs(w1) - fr);
  sim.phi += sim.omega*dt;
  sim.P  = sim.Tb*sim.omega + Th*Math.abs(sim.omega);         // instantânea: é a que aquece a trilha
  sim.PM = sim.TbM*sim.omega + sim.ThM*Math.abs(sim.omega);   // média no ciclo (HUD)
  // elétrico: R(T)·N², L ∝ N²·sat com L = (2N)²·permeância (franja + ferro + fuga), I²R, tensão e perda de transformador no disco (ptrOut, acima)
  const Lc = Ll*sim.sat;
  sim.PJ  = P.coilDyn ? Rc*(ac ? sim.i2m : i2) : Irms*Irms*Rc;
  sim.V   = P.coilDyn && !ac ? sim.Vapp : sim.Iact*Math.hypot(Rc, ac ? om*Lc : 0);
  if (!P.coilDyn) sim.Vapp = sim.V;
  sim.Jcu = sim.Iact*params.turns/(C.kFill*(C.aWin ?? P.turns0*P.ratedA/5e6/0.6))/1e6;   // J = N·I/(k_f·A_janela), A/mm² (janela fixa)
  const shield = 1 + (om*GEO.mu0*ed.G*mp.aE/(2*mp.TH))**2;
  sim.Ptr = !ac ? 0 : P.ptrDisc ? ed.G*om*om*st.d2*Math.PI*mp.aE**4/8*(1 + mp.ptrOut)/shield
                               : Math.PI*ed.G*mp.aE**4/8*om*om*st.b2/shield;
  const PtrIn = P.ptrDisc ? sim.Ptr/(1 + mp.ptrOut) : sim.Ptr;   // parte sob o polo → trilha; a que fecha fora do polo → resto do disco
  sim.Pel = sim.PJ + sim.Ptr;   // potência ativa da fonte; Tb·ω vem do eixo, não da fonte
  // térmico: trilha (anel varrido) → disco → ambiente (convecção hConv + radiação com ε do material); bobina com nó próprio
  const Ct = mp.thermalMass*P.trackFrac, Cd = mp.thermalMass - Ct, flow = mp.gTrack*(sim.tTrack - sim.temp);
  const hTot = hTotal(mp, aw, sim.temp);
  sim.tTrack += (sim.P*P.heatFrac + PtrIn - flow)/Ct*dt;
  sim.temp   += (flow + sim.Ptr - PtrIn - hTot*P.area*(sim.temp - P.ambient))/Cd*dt;
  sim.tCoil  += (sim.PJ - C.G*(sim.tCoil - P.ambient))/C.C*dt;
}
