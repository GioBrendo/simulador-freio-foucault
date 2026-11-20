// Testes da física: node --test tests/
// Cu e Al são comparados passo a passo com o physics.js original do Projeto_COM_NUCLEO (matemática de referência),
// num clone temporário com o MESMO disco (Ø150: só DISC.R muda; o original foi escrito para escalar a partir dele).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as N from '../js/physics.js';
import { CONFIG } from '../js/config.js';
const ORIG = new URL('../../Projeto_COM_NUCLEO-main/js/', import.meta.url);
const refDir = mkdtempSync(join(tmpdir(), 'ref-com-nucleo-'));
const cfg = readFileSync(new URL('config.js', ORIG), 'utf-8');
// mesmo disco e mesmo PROJETO (entreferro, seção do braço, σ do Cu, corrente nominal): só o modelo pode diferir
const CORE = CONFIG.core;
const PATCH = [
  ['const DISC = { R:1.25, T:0.05 }', `const DISC = { R:${CONFIG.disc.R}, T:${CONFIG.disc.T} }`],
  ['const G_TOT  = 2*0.6*D + D;', `const G_TOT  = 2*${CONFIG.disc.gapF}*D + D;`],
  ['const A_LIMB = 0.95*(0.4*U)*(1.0*U);', `const A_LIMB = 0.95*(${CORE.limbT}*U)*(${CORE.limbW}*U);`],
  ['sigma:5.96e7', `sigma:${CONFIG.materials.Cu.sigma}`],
  ['RATED_A = 12', `RATED_A = ${CONFIG.phys.ratedA}`],
];
let cfgRef = cfg;
for (const [a, b] of PATCH){ assert.ok(cfgRef.includes(a), `config original sem "${a}"`); cfgRef = cfgRef.replace(a, b); }
writeFileSync(join(refDir, 'config.js'), cfgRef);
writeFileSync(join(refDir, 'physics.js'), readFileSync(new URL('physics.js', ORIG)));
writeFileSync(join(refDir, 'package.json'), '{"type":"module"}');
const O = await import(pathToFileURL(join(refDir, 'physics.js')).href);
// correções novas desligadas ⇒ a matemática tem de ser exatamente a do COM_NUCLEO
const NEW = { edgeCorr:false, expStep:false, acInst:false, ptrDisc:false, hDisc:false, yokeAir:false,
              fringe:false, bhCurve:false, coilDyn:false, skinAll:false, leverArm:false, matEps:false, motorReal:false };
function asOriginal(fn){
  const P = CONFIG.phys, keep = { inertiaHub:P.inertiaHub, motorJ:P.motorJ, coil:P.coil };
  for (const k in NEW) keep[k] = P[k];
  Object.assign(P, NEW, { inertiaHub:7e-4, motorJ:0, coil:P.coilOrig });   // coilOrig: bobina do desenho antigo (L com K_F, G = 1,5 W/K)
  try { fn(); } finally { Object.assign(P, keep); }
}
// liga/desliga chaves de phys só durante fn
function withP(over, fn){
  const P = CONFIG.phys, keep = {};
  for (const k in over) keep[k] = P[k];
  Object.assign(P, over);
  try { return fn(); } finally { Object.assign(P, keep); }
}

const DT = 1/120, W900 = 900*Math.PI/30, G = CONFIG.phys.geo;
const BASE = { rpm:900, exc:1, freq:1.2, hold:false, motor:true, mode:'ac', dir:1, mat:'Cu', turns:240, circ:'C' };
function run(M, p, w0, n, every = 30){
  Object.assign(M.params, BASE, p);
  M.resetSim(w0);
  const out = [];
  for (let i = 1; i <= n; i++){ M.step(DT); if (i % every === 0) out.push({ ...M.sim }); }
  return out;
}
const close = (a, b, rel, abs = 1e-12) => Math.abs(a - b) <= rel*Math.max(Math.abs(a), Math.abs(b)) + abs;
const CASES = [
  ['CA com motor', { mode:'ac' }, 0],
  ['CC com motor', { mode:'dc' }, 0],
  ['CA emergência', { mode:'ac', motor:false }, W900],
  ['CC emergência', { mode:'dc', motor:false }, W900],
  ['CA 3000 esp. 2 Hz', { mode:'ac', turns:3000, freq:2, exc:0.4 }, W900],
];

test('cu identico ao original (COM_NUCLEO) com as correcoes novas desligadas', () => asOriginal(() => {
  for (const [name, p, w0] of CASES){
    const a = run(N, { ...p, mat:'Cu' }, w0, 600), b = run(O, { ...p, mat:'Cu' }, w0, 600);
    a.forEach((s, i) => { for (const k of ['omega','Tb','P','PJ','Ptr','V','temp','tTrack','tCoil'])
      assert.ok(close(s[k], b[i][k], 1e-9), `${name} · passo ${(i+1)*30} · ${k}: ${s[k]} ≠ ${b[i][k]}`); });
  }
}));

test('al proximo do original (so o k termico difere)', () => asOriginal(() => {
  for (const [name, p, w0] of CASES){
    const a = run(N, { ...p, mat:'Al' }, w0, 600), b = run(O, { ...p, mat:'Al' }, w0, 600);
    a.forEach((s, i) => { for (const k of ['omega','Tb'])
      assert.ok(close(s[k], b[i][k], 1e-3, 1e-6), `${name} · passo ${(i+1)*30} · ${k}: ${s[k]} ≠ ${b[i][k]}`); });
  }
}));

test('disco Ø150 × 5 mm e polo cabe entre o cubo e a borda', () => {
  assert.equal(Math.round(CONFIG.disc.R*200), 150); assert.ok(close(G.D, 0.005, 1e-12));
  const U = G.RM/CONFIG.disc.Rv;
  assert.ok(G.poleR + N.matProps('Cu').aE < G.RM, 'polo equivalente passa da borda');
  assert.ok(G.poleR - CORE.flangeR*U > 0.85*U + 1e-3, 'bobina encosta no cubo');   // flange da bobina × cubo (r 0,85 un.): folga ≥ 1 mm
});

test('borda: K_G = 1 − (a/R)²/(1 − (r/R)²)² com o polo equivalente a_ef', () => {
  const kg0 = 1 - (G.poleA/G.RM)**2/(1 - (G.poleR/G.RM)**2)**2;
  assert.ok(Math.abs(kg0 - 0.865) < 0.002, `K_G geométrico ${kg0}`);
  const mp = N.matProps('Cu'), kg = 1 - (mp.aE/G.RM)**2/(1 - (G.poleR/G.RM)**2)**2;
  const off = withP({ edgeCorr:false }, () => N.matProps('Cu').KT);
  assert.ok(close(mp.KT/off, kg, 1e-12), `${mp.KT/off} × ${kg}`);
});

test('inercia: disco + cubo/eixo (∝ R⁵) + rotor do motor', () => {
  const P = CONFIG.phys;
  assert.ok(close(P.inertiaHub, 7e-4*(G.RM/0.125)**5, 1e-12));
  assert.ok(close(N.inertia(), P.inertiaDisc + P.inertiaHub + P.motorJ, 1e-15));
  assert.ok(P.motorJ > 0);
});

test('desmagnetizacao: valores conhecidos do esferoide (m = 0,5; 1; 2)', () => {
  assert.ok(Math.abs(N.demag(1) - 1/3) < 1e-6);
  assert.ok(Math.abs(N.demag(2) - 0.17356) < 2e-4);
  assert.ok(Math.abs(N.demag(0.5) - 0.52720) < 2e-4);
});

test('sem circuito magnetico: B/A cai (retorno pelo ar) e satura pela perna', () => {
  const c = N.matProps('Cu', 'C'), o = N.matProps('Cu', 'open'), r = o.bPerA/c.bPerA;
  assert.ok(r > 0.3 && r < 0.6, `B aberto/fechado ${r}`);
  assert.ok(close(o.bSat, G.bSatFe*G.aLeg/(o.F*G.aGap), 1e-12));   // a perna leva o fluxo de toda a face equivalente
  assert.ok(o.lScale < 1 && close(o.lScale, r, 0.15), `L aberto/fechado ${o.lScale}`);   // L ∝ permeância total (a fuga entre braços some sem culatra)
  assert.equal(o.KT, c.KT);   // mesmo polo e entreferro local → mesmo Tmáx por B² e mesma ωc
});

test('nucleo em C nunca freia menos que sem circuito (culatra em paralelo com o ar)', () => {
  for (const mat of Object.keys(CONFIG.materials)) for (const mode of ['dc','ac']) for (const turns of [60, 240, 3000]) for (const exc of [0.05, 0.3, 1, 2, 3, 5, 8]){
    // mesma velocidade e temperatura: torque de Foucault ∝ <B²>, histerese ∝ <|B|ⁿ> → basta comparar as médias de B
    run(N, { mat, mode, turns, exc, circ:'C' }, W900, 1, 1); const c = N.curveNow();
    run(N, { mat, mode, turns, exc, circ:'open' }, W900, 1, 1); const o = N.curveNow();
    assert.ok(c.Bq >= o.Bq*(1 - 1e-12) && c.bn >= o.bn*(1 - 1e-12), `${mat} ${mode} ${turns} esp. exc ${exc}: C ${c.Bq} T < aberto ${o.Bq} T`);
  }
  // baixa corrente: B ≈ B linear (culatra não saturada; curva B-H com μr inicial do aço-Si); corrente enorme: C continua ≥ aberto
  N.params.turns = 240; N.params.circ = 'C';
  const mp = N.matProps('Cu', 'C');
  assert.ok(close(N.bOf(0.01, mp), mp.bInst*0.01, 0.03), `${N.bOf(0.01, mp)} × ${mp.bInst*0.01}`);
  assert.ok(N.bOf(1e6, mp) >= N.bOf(1e6, N.matProps('Cu', 'open')));
  // modelo tanh (sem curva B-H): as pernas limitam os dois modos
  withP({ bhCurve:false }, () => assert.ok(close(N.bOf(1e6, N.matProps('Cu', 'C')), N.matProps('Cu', 'open').bSat, 1e-9)));
});

test('sem circuito: disco de aco ganha menos (o ar domina a relutancia)', () => {
  const gC = N.matProps('Galv','C').bPerA/N.matProps('Cu','C').bPerA, gO = N.matProps('Galv','open').bPerA/N.matProps('Cu','open').bPerA;
  assert.ok(gO > 1 && gO < gC, `aberto ${gO} · fechado ${gC}`);
});

test('params.circ troca o circuito no passo', () => {
  run(N, { circ:'C', exc:0.3 }, 0, 2); const bc = N.peakB();
  run(N, { circ:'open', exc:0.3 }, 0, 2); const bo = N.peakB();
  assert.ok(bo < 0.7*bc, `${bo} vs ${bc}`);
  N.params.circ = 'C';
});

test('galv: B/A maior abaixo da saturacao (disco entra no circuito magnetico)', () => {
  const c = N.matProps('Cu'), s = N.matProps('Galv'), r = s.bPerA/c.bPerA;
  assert.ok(close(s.g, G.gap2 + G.D/200, 1e-12));
  assert.ok(close(r, (c.g/s.g)*(s.kLin/c.kLin), 1e-12));   // o ferro pesa mais quando o entreferro encolhe
  assert.ok(r > 2.3 && r < 2.8, `razão ${r}`);
  assert.ok(close(c.g, 0.008, 1e-12));
});

test('galv: delta infinito parado em CC (d_ef = d)', () => {
  N.params.mode = 'dc';
  const sh = N.sheet(N.matProps('Galv'), 0, 20);
  assert.equal(sh.delta, Infinity);
  assert.equal(sh.dEff, G.D);
});

test('galv: zinco soma 2·σZn·tZn a condutancia de folha', () => {
  N.params.mode = 'dc';
  const mp = N.matProps('Galv'), sh = N.sheet(mp, 1000, 20);
  assert.ok(sh.delta < G.D, `δ ${sh.delta}`);
  assert.ok(close(sh.G - mp.sigma*sh.dEff, 2*1.69e7*20e-6, 1e-9), `G ${sh.G}`);
});

test('cu: efeito pelicular tambem em Cu/Al (d/δ > 1 a 2400 rpm)', () => {
  N.params.mode = 'dc';
  const mp = N.matProps('Cu'), w = 2400*Math.PI/30, sh = N.sheet(mp, w, 20);
  assert.ok(G.D/sh.delta > 1, `d/δ ${G.D/sh.delta}`);
  assert.ok(close(sh.dEff, 2*sh.delta*Math.tanh(G.D/(2*sh.delta)), 1e-12));
  assert.ok(sh.dEff < 0.95*G.D, `d_ef ${sh.dEff}`);
  assert.ok(close(sh.G, sh.sigma*sh.dEff, 1e-12));
  withP({ skinAll:false }, () => { const s0 = N.sheet(mp, w, 120); assert.equal(s0.dEff, G.D); assert.ok(close(s0.G, mp.sigma/(1 + mp.alpha*100)*G.D, 1e-12)); });
});

test('aco: T ∝ ω^-1/2 em alta rotacao (efeito pelicular)', () => {
  run(N, { mat:'Fe', mode:'dc' }, 0, 1);
  const th = N.curveNow().th, T = w => N.torqueAt(w) - th;   // só a parcela de Foucault (a histerese é constante)
  const r = T(4e5)/T(1e5);
  assert.ok(r > 0.45 && r < 0.55, `razão ${r}`);
});

test('wPeak: Cu igual a ωc do original sem as correcoes; galvanizado bem acima e no maximo da curva', () => {
  withP({ fringe:false, skinAll:false }, () => assert.ok(close(N.wPeak('Cu'), CONFIG.phys.slip0, 1e-6), `${N.wPeak('Cu')} vs ${CONFIG.phys.slip0}`));
  const mp = N.matProps('Cu'), w0 = 2*mp.TH/(G.mu0*mp.sigma*G.D*G.poleR);   // folha fina, polo equivalente
  assert.ok(N.wPeak('Cu') >= w0*(1 - 1e-9), 'pelicular só pode subir ωc (d_ef ≤ d)');
  const wg = N.wPeak('Galv');
  assert.ok(Number.isFinite(wg) && wg > 5*N.wPeak('Cu'), `ωc galv ${wg}`);
  run(N, { mat:'Galv', mode:'dc' }, 0, 1);
  const T = N.torqueAt;
  assert.ok(T(wg) > T(0.7*wg) && T(wg) > T(1.4*wg), 'wPeak não é o pico de T(ω)');
});

test('galv: histerese positiva e so em disco ferromagnetico', () => {
  run(N, { mat:'Galv' }, 0, 1); assert.ok(N.sim.Th > 0, `Th ${N.sim.Th}`);
  assert.ok(N.sim.Fax > 0, `Fax ${N.sim.Fax}`);
  run(N, { mat:'Cu' }, 0, 1); assert.equal(N.sim.Th, 0); assert.equal(N.sim.Fax, 0);
});

test('reverso: torque se opoe ao giro e histerese nao inverte o sentido', () => {
  const s = run(N, { mat:'Galv', dir:-1 }, 0, 1200, 1200)[0];
  assert.ok(s.omega < -10, `ω ${s.omega}`);
  assert.ok(s.Tb*s.omega >= 0);
  const e = run(N, { mat:'Galv', motor:false }, -W900, 1200, 60);
  e.forEach(x => assert.ok(x.omega <= 0, `inverteu: ${x.omega}`));
});

test('estabilidade: sliders no extremo dao valores finitos', () => {
  for (const mat of Object.keys(CONFIG.materials)) for (const mode of ['ac','dc']) for (const circ of ['C','open']){
    const s = run(N, { mat, mode, circ, turns:3000, exc:8, rpm:2400, freq:8 }, 0, 2400, 2400)[0];
    for (const [k, v] of Object.entries(s)) assert.ok(Number.isFinite(v), `${mat} ${mode} ${circ} ${k} = ${v}`);
  }
});

test('parada: t = J/(2Tmax)·[wc·ln(w0/w1) + (w0²−w1²)/(2wc)] bate com Simpson e com a simulacao (Cu, CC, sem atrito)', () => {
  // fórmula fechada: ωc constante (sem pelicular) e campo já estabelecido (corrente imposta)
  const P = CONFIG.phys, keep = { lossA:P.lossA, lossB:P.lossB, lossC:P.lossC, skinAll:P.skinAll, coilDyn:P.coilDyn };
  Object.assign(P, { lossA:0, lossB:0, lossC:0, skinAll:false, coilDyn:false });
  try {
    Object.assign(N.params, BASE, { mode:'dc', motor:false }); N.resetSim(W900); N.step(DT);
    const { wc, tmax, Bq } = N.curveNow(), w0 = N.sim.omega, w1 = W900/10;
    const ta = N.stopTimeSchieber(N.inertia(), tmax, wc, w0, w1), tn = N.stopTime(w0, w1, Bq);
    assert.ok(close(tn, ta, 1e-3), `Simpson ${tn} × analítico ${ta}`);
    let t = 0; while (N.sim.omega > w1 && t < 5){ N.step(DT); t += DT; }
    assert.ok(close(t, ta, 0.02, DT), `simulação ${t} × analítico ${ta}`);
  } finally { Object.assign(P, keep); }
});

test('tauCoil: L/R independe de N (40–80 ms no nucleo em C) e cai sem culatra', () => {
  const C = CONFIG.phys.coil, mp = N.matProps('Cu', 'C'), tC = N.tauCoil(mp), tO = N.tauCoil(N.matProps('Cu', 'open'));
  assert.ok(close(tC, N.lLin(mp)/C.R20, 1e-12), `τ ${tC}`);
  assert.ok(tC > 0.04 && tC < 0.08, `τ ${tC}`);
  assert.ok(tO < tC, `τ aberto ${tO} ≥ τ C ${tC}`);
});

test('L linear = (2N)²·(K_lin·μ0·A_ef/g + P_fuga): franjamento e fuga enlaçam a bobina', () => {
  const mp = N.matProps('Cu', 'C'), N0 = CONFIG.phys.turns0;
  const L = 4*N0**2*(mp.kLin*G.mu0*mp.F*G.aGap/mp.g + G.pLeak);
  assert.ok(close(N.lLin(mp), L, 1e-12), `L ${N.lLin(mp)} × ${L}`);
  assert.ok(CONFIG.phys.coil.Lair > 0.03*L && CONFIG.phys.coil.Lair < 0.2*L, `L_ar ${CONFIG.phys.coil.Lair}`);   // piso de L com o núcleo saturado
});

test('CA: torque instantaneo pulsa em 2f e a media no ciclo bate com TbM', () => {
  // f = 1,2 Hz → período do torque 1/2f = 50 passos de 1/120 s; amostra 4 períodos com o motor segurando a rotação
  const s = run(N, { mode:'ac', exc:0.5 }, W900, 600 + 200, 1).slice(600);
  const tb = s.map(x => x.Tb), tm = s.map(x => x.TbM), avg = a => a.reduce((p, q) => p + q, 0)/a.length;
  assert.ok(close(avg(tb), avg(tm), 0.03), `média ${avg(tb)} × TbM ${avg(tm)}`);
  assert.ok(Math.min(...tb) < 0.1*avg(tm), `mínimo ${Math.min(...tb)}`);
  assert.ok(Math.max(...tb) > 1.5*avg(tm), `máximo ${Math.max(...tb)}`);
  const c = run(N, { mode:'dc' }, W900, 2, 1)[1];   // CC: instantâneo = médio
  assert.equal(c.Tb, c.TbM);
});

test('transformador: correntes fora do polo multiplicam a perda por 1 + 4·ln((R²−r²)/(R·a))', () => {
  const P = CONFIG.phys, f = 1 + 4*Math.log((G.RM**2 - G.poleR**2)/(G.RM*N.matProps('Cu').aE));   // a: polo equivalente
  const on = run(N, { mode:'ac', exc:0.02 }, 0, 1, 1)[0].Ptr;   // excitação baixa: sem saturação, <Ḃ²> = ω²·B_ef²
  P.ptrDisc = false;
  try { const off = run(N, { mode:'ac', exc:0.02 }, 0, 1, 1)[0].Ptr; assert.ok(close(on/off, f, 2e-3), `razão ${on/off} × ${f}`); }
  finally { P.ptrDisc = true; }
  assert.ok(f > 4 && f < 6, `fator ${f}`);
  // saturado: as harmônicas aumentam <Ḃ²> acima de ω²·<B²> (razão > fator geométrico)
  const sat = run(N, { mode:'ac', exc:2 }, 0, 1, 1)[0].Ptr;
  P.ptrDisc = false;
  try { const off = run(N, { mode:'ac', exc:2 }, 0, 1, 1)[0].Ptr; assert.ok(sat/off > f, `saturado: razão ${sat/off} ≤ ${f}`); }
  finally { P.ptrDisc = true; }
});

test('convecção: h_rot = 0,36·k·√(ω/ν) (disco laminar) e natural parado', () => {
  const A = CONFIG.phys.air, h900 = N.hConv(W900, 0);
  assert.ok(close(h900, 0.36*A.k*Math.sqrt(W900/A.nu), 1e-12), `h ${h900}`);
  assert.ok(close(N.hConv(4*W900, 0)/h900, 2, 1e-9), 'h ∝ √ω');
  assert.ok(h900 > 15 && h900 < 35, `h(900 rpm) ${h900}`);
  assert.ok(N.hConv(0, 50) > 4 && N.hConv(0, 50) < 8, `h natural ${N.hConv(0, 50)}`);
  assert.equal(N.hConv(0, 0), 0);
});

test('material desconhecido cai para Cu', () => {
  assert.equal(N.matProps('xyz').name, CONFIG.materials.Cu.name);
});

/* ============================================================ revisão 3: correções da auditoria */
const U = G.RM/CONFIG.disc.Rv;

test('projeto: entreferro 1,5 mm/lado; braco e perna nao estrangulam o fluxo da face polar', () => {
  assert.ok(close(G.gap2/2, 1.5e-3, 1e-9), `g0 ${G.gap2/2}`);
  assert.ok(close(CONFIG.disc.gap*CONFIG.disc.mm, 1.5, 1e-9), 'cena com outro entreferro');
  assert.ok(G.aLimb >= 360e-6, `A_braço ${G.aLimb*1e6} mm²`);
  assert.ok(G.aLeg >= G.aLimb, 'perna mais fina que o braço');
});

test('bobina cabe na janela desenhada, J nominal ≤ 4 A/mm² e perna comporta a bobina', () => {
  const C = CONFIG.phys.coil, N0 = CONFIG.phys.turns0;
  const win = (CORE.coilRo - CORE.coilRi)*CORE.coilH*U*U;
  assert.ok(close(C.aWin, N0*C.aWire/C.kFill, 1e-12));
  assert.ok(C.aWin <= win*(1 + 1e-9), `janela ${win*1e6} mm² < ${C.aWin*1e6} mm²`);
  const J = CONFIG.phys.ratedA/C.aWire/1e6;
  assert.ok(J <= 4, `J ${J} A/mm²`);
  assert.ok(CORE.legL >= CORE.coilH + 2*CORE.flange, 'bobina mais longa que a perna');
  assert.ok(CORE.coilRi > CORE.legR, 'bobina dentro da perna');
});

test('bobina: R pela espira media da janela real; G termico = h·A_ext (conveccao natural)', () => {
  const C = CONFIG.phys.coil, N0 = CONFIG.phys.turns0, lm = Math.PI*(CORE.coilRi + CORE.coilRo)*U;
  assert.ok(close(C.lm, lm, 1e-12));
  assert.ok(close(C.R20, 1.72e-8*2*N0*lm/C.aWire, 1e-12), `R20 ${C.R20}`);
  assert.ok(close(C.G, C.hCoil*C.aExt, 1e-12));
  assert.ok(C.G > 0.15 && C.G < 0.6, `G ${C.G} W/K`);
  assert.ok(C.C > 300 && C.C < 600, `C ${C.C} J/K`);
});

test('franjamento (Roters) e fuga substituem K_F; aco tem g menor e franja menos', () => {
  const c = N.matProps('Cu'), s = N.matProps('Fe'), a = G.poleA, t = G.shoeT;
  const F = g => 1 + 2*Math.PI*a*(0.26 + Math.log(1 + 2*t/g)/Math.PI)*g/(Math.PI*a*a);
  assert.ok(close(c.F, F(c.g), 1e-12)); assert.ok(c.F > 1.3 && c.F < 1.8, `F ${c.F}`);
  assert.ok(close(c.aE, a*Math.sqrt(c.F), 1e-12));
  assert.ok(s.F < c.F, `F aço ${s.F} ≥ Cu ${c.F}`);
  assert.ok(c.kLin > 0.9 && c.kLin < 1, `K_lin ${c.kLin}`);
  // braço e perna levam o fluxo da face equivalente (a fuga entre braços fica em paralelo com a coluna: alivia o retorno, não carrega o braço)
  assert.ok(close(c.bSat, G.bSatFe*G.aLimb/(c.F*G.aGap), 1e-12));
  assert.ok(close(c.bLeg, G.bSatFe*G.aLeg/(c.F*G.aGap), 1e-12));
  assert.ok(c.bSat < G.bSatGap, `teto do braço ${c.bSat} ≥ K_F antigo ${G.bSatGap}`);
});

test('curva B-H do aco-Si (M400-50A): pontos da norma EN 10106 e extrapolacao com μ0', () => {
  assert.equal(N.hFe(0), 0);
  assert.ok(close(N.hFe(1.53), 2500, 1e-12) && close(N.hFe(1.63), 5000, 1e-12) && close(N.hFe(1.73), 10000, 1e-12));
  assert.ok(close(N.hFe(2.0) - N.hFe(1.9), 0.1/G.mu0, 1e-9), 'acima da tabela: inclinação μ0');
  assert.ok(close(N.hFe(-1.2), -N.hFe(1.2), 1e-12));
  for (let b = 0.05; b < 2.5; b += 0.05) assert.ok(N.hFe(b + 0.01) > N.hFe(b), `H(B) não monótona em ${b}`);
});

test('circuito com curva B-H: B(i) fecha o balanco de MMF (gap + pernas + retorno) nos dois circuitos', () => {
  const N0 = CONFIG.phys.turns0;
  N.params.turns = N0;
  for (const circ of ['C', 'open']) for (const mat of ['Cu', 'Galv']) for (const I of [0.5, 6, 12, 48, 400]){
    const mp = N.matProps(mat, circ), B = N.bOf(I, mp);
    assert.ok(close(N.mmfOf(B, mp), 2*N0*I, 2e-3), `${mat} ${circ} ${I} A: MMF(B) ${N.mmfOf(B, mp)} × ${2*N0*I}`);
  }
  // corrente nominal: braço a ~1,2 T, ainda no trecho linear do aço-Si → B quase o valor linear (K_lin)
  const mp = N.matProps('Cu', 'C'), B6 = N.bOf(CONFIG.phys.ratedA, mp);
  assert.ok(B6 > 0.95*mp.bInst*CONFIG.phys.ratedA, `B(6 A) ${B6} × linear ${mp.bInst*CONFIG.phys.ratedA}`);
  // 4× a corrente: o braço passa do joelho e o ganho por ampère cai
  assert.ok(N.bOf(4*CONFIG.phys.ratedA, mp) < 0.75*4*B6);
});

test('torque: polo equivalente a_ef e braco de alavanca r² + a²/2', () => {
  const mp = N.matProps('Cu'), TH = Math.tanh(Math.PI*mp.g/(4*mp.aE)), kg = 1 - (mp.aE/G.RM)**2/(1 - (G.poleR/G.RM)**2)**2;
  const lev = 1 + mp.aE**2/(2*G.poleR**2), KT = 0.5*Math.PI*mp.aE**2*G.poleR*TH/G.mu0*kg*lev;
  assert.ok(close(mp.TH, TH, 1e-12));
  assert.ok(close(mp.KT, KT, 1e-12), `${mp.KT} × ${KT}`);
  withP({ leverArm:false }, () => assert.ok(close(N.matProps('Cu').KT*lev, KT, 1e-12)));
});

test('bobina com fonte "seca" (V = R·I): i(t) = I·(1 − e^(−t/τ)) e a frenagem atrasa', () => {
  const C = CONFIG.phys.coil, vb = C.vBus, P = CONFIG.phys, exc = 0.2;
  const Rc = C.R20*(1 + C.alpha*(P.ambient - 20)), I = exc*P.ratedA, tau = N.lLin(N.matProps('Cu', 'C'))/Rc;
  C.vBus = Rc*I;
  try {
    const n = Math.round(tau/DT), s = run(N, { mode:'dc', exc, motor:false }, 0, n, n)[0];
    assert.ok(close(s.I/I, 1 - Math.exp(-n*DT/tau), 0.03), `i/I ${s.I/I} × ${1 - Math.exp(-n*DT/tau)}`);
    // parada 900 → 90 rpm: corrente imposta × fonte seca
    const tStop = () => { Object.assign(N.params, BASE, { mode:'dc', motor:false, exc:1 }); N.resetSim(W900); let t = 0; while (N.sim.omega > W900/10 && t < 5){ N.step(DT); t += DT; } return t; };
    C.vBus = Rc*P.ratedA;
    const tDyn = tStop(), tImp = withP({ coilDyn:false }, tStop);
    assert.ok(tDyn > 1.1*tImp, `com L/R ${tDyn} s × imposta ${tImp} s`);
  } finally { C.vBus = vb; }
});

test('bobina com fonte regulada (vBus): forca a subida e segue a senoide em CA', () => {
  const P = CONFIG.phys, I = P.ratedA, tau = N.tauCoil(N.matProps('Cu', 'C'));
  const s = run(N, { mode:'dc', exc:1, motor:false }, 0, Math.ceil(tau/3/DT), 1);
  assert.ok(Math.abs(s.at(-1).I/I - 1) < 0.01, `i/I ${s.at(-1).I/I} após τ/3`);
  const a = run(N, { mode:'ac', exc:1, freq:2 }, W900, 240, 1).slice(120);
  for (const x of a) assert.ok(Math.abs(x.I - Math.SQRT2*I*Math.sin(x.theta)) < 0.05*I, `CA: i ${x.I} × ref ${Math.SQRT2*I*Math.sin(x.theta)}`);
});

test('CA: valor eficaz real = RMS do ultimo periodo (sem ondulacao em 2f)', () => {
  const I = CONFIG.phys.ratedA, s = run(N, { mode:'ac', exc:1, freq:1.2 }, W900, 240, 1).slice(120);
  for (const x of s) assert.ok(Math.abs(x.Iact/I - 1) < 0.01, `I_ef ${x.Iact} × ${I}`);
});

test('densidade de corrente: J = N·I/(k_f·A_janela); fonte limita a corrente com muitas espiras', () => {
  const C = CONFIG.phys.coil, P = CONFIG.phys;
  const s = run(N, { mode:'dc', exc:1 }, 0, 120, 120)[0];
  assert.ok(close(s.Jcu, P.ratedA/C.aWire/1e6, 0.01), `J ${s.Jcu}`);
  const h = run(N, { mode:'dc', exc:8, turns:3000 }, 0, 240, 240)[0];   // fio 12,5× mais fino: R ×156
  assert.ok(h.Iact < 0.1*8*P.ratedA, `I ${h.Iact}`);
  assert.ok(close(h.Jcu, h.Iact*3000/(C.kFill*C.aWin)/1e6, 1e-9));
});

test('emissividade por material (Cu/Al usinados ≪ 0,4)', () => {
  const M = CONFIG.materials;
  assert.ok(M.Cu.eps <= 0.15 && M.Al.eps <= 0.15 && M.Al6061.eps <= 0.15);
  const mp = N.matProps('Cu'); assert.equal(mp.eps, M.Cu.eps);
  const h1 = N.hTotal(mp, 0, 200), h0 = withP({ matEps:false }, () => N.hTotal(N.matProps('Cu'), 0, 200));
  assert.ok(h0 > h1, `ε fixo 0,4: ${h0} ≤ ${h1}`);
});

test('motor real: 0,55 kW 2 polos → T_n = 1,84 N·m, rigidez T_n/ω_escorr. e limite 1,5·T_n', () => {
  const P = CONFIG.phys, m = P.motor, Tn = m.Pn/(m.nN*Math.PI/30);
  assert.ok(close(m.Tn, Tn, 1e-12) && Math.abs(Tn - 1.843) < 0.01, `T_n ${m.Tn}`);
  assert.ok(close(m.gain, Tn/((m.nS - m.nN)*Math.PI/30), 1e-12));
  assert.ok(close(m.max, 1.5*Tn, 1e-12) && close(m.min, -1.5*Tn, 1e-12));
  const s = run(N, { mode:'dc', exc:1, rpm:900 }, W900, 900, 900)[0], w = s.omega;
  const load = s.TbM + P.lossA + P.lossB*w + P.lossC*w*w;
  assert.ok(close((W900 - w)*m.gain, load, 0.02), `escorregamento ${(W900 - w)*m.gain} × carga ${load}`);
});

test('materiais comerciais: Cu C11000 5,80 MS/m; Al 1050 e Al 6061-T6 (Matthiessen: α/σ constante)', () => {
  const M = CONFIG.materials;
  assert.equal(M.Cu.sigma, 5.80e7);
  assert.equal(M.Al6061.sigma, 2.5e7); assert.equal(M.Al6061.k, 167);
  assert.ok(close(M.Al6061.alpha/M.Al.alpha, M.Al6061.sigma/M.Al.sigma, 0.05));
});
