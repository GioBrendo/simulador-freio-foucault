import { CONFIG } from './config.js';
import { params, sim, resetSim, matProps, wPeak, tauCoil, lLin } from './physics.js';
import { matCopper, groove, spangleTex } from './materials.js';
import * as THREE from 'three';
import { renderer, render, camera, controls } from './scene.js';

const $ = id => document.getElementById(id);
const H = CONFIG.heat, AMB = CONFIG.phys.ambient, MATS = CONFIG.materials;

/* ---------- paleta inferno (uniforme perceptualmente); mesma da GLSL em main.js ---------- */
export const INFERNO_GLSL = `vec3 pal(float t){
  const vec3 c0=vec3(0.0002189,0.0016510,-0.0194809),c1=vec3(0.1065134,0.5639564,3.9327124),c2=vec3(11.6024931,-3.9728540,-15.9423941),
  c3=vec3(-41.7039961,17.4363989,44.3541452),c4=vec3(77.1629357,-33.4023589,-81.8073093),c5=vec3(-71.3194282,32.6260643,73.2095199),c6=vec3(25.1311262,-12.2426690,-23.0703250);
  return clamp(c0+t*(c1+t*(c2+t*(c3+t*(c4+t*(c5+t*c6))))),0.,1.); }`;
const cs = [[0.0002189,0.0016510,-0.0194809],[0.1065134,0.5639564,3.9327124],[11.6024931,-3.9728540,-15.9423941],[-41.7039961,17.4363989,44.3541452],[77.1629357,-33.4023589,-81.8073093],[-71.3194282,32.6260643,73.2095199],[25.1311262,-12.2426690,-23.0703250]];
const inferno = t => [0,1,2].map(k => Math.round(255*Math.min(1, Math.max(0, cs.reduceRight((a,c)=>a*t + c[k], 0)))));
const ramp = () => 'linear-gradient(90deg,' + [...Array(9)].map((_,k)=>`rgb(${inferno(k/8)}) ${k*12.5}%`) + ')';
function paintLegends(){
  $('lgH').firstElementChild.style.background = ramp(); $('lgB').firstElementChild.style.background = ramp();
  const pos = T => (T-AMB)/(H.tMax-AMB)*100, box = $('lgH').lastElementChild;
  box.style.cssText = 'position:relative;height:11px;display:block';
  box.innerHTML = [AMB,100,200,300,H.tMax].map((T,k)=>`<span style="position:absolute;left:${pos(T)}%;transform:translateX(${k===0?0:k===4?-100:-50}%)">${T}${k===4?' °C':''}</span>`).join('');
  box.title = 'Temperatura estimada do disco (média + trilha sob o polo); escala didática';
}

/* ---------- controles: modo, sentido, material ---------- */
const selMode = $('selMode'), selMat = $('selMat'), selCirc = $('selCirc'), btnDir = $('btnDir');
const setRange = (id, v) => { const el = $(id); el.value = v; el.dispatchEvent(new Event('input')); };
function setMode(m){ params.mode = m === 'dc' ? 'dc' : 'ac'; selMode.value = params.mode;
  $('inFrq').disabled = params.mode === 'dc'; $('lgT').textContent = params.mode === 'dc' ? 'torque · constante' : 'torque · 2f'; }
function setDir(d){ params.dir = +d < 0 ? -1 : 1; btnDir.textContent = params.dir < 0 ? 'SENTIDO DO EIXO: ↺ REVERSO' : 'SENTIDO DO EIXO: ↻ NORMAL'; btnDir.setAttribute('aria-pressed', params.dir < 0); }
const DISC_TXT = `Ø${Math.round(CONFIG.disc.R*200)} × ${+(CONFIG.disc.T*100).toFixed(1)} mm`;
function setMat(k){ if (!MATS[k]) k = 'Cu'; params.mat = k; selMat.value = k; const m = MATS[k], mp = matProps(k), sp = !!m.spangle;
  // galvanizado: textura de flor de zinco (cor + rugosidade), sem sulcos de torneamento; demais: sulcos usinados (rugosidade + relevo)
  matCopper.color.setHex(m.color); matCopper.metalness = m.metal;
  matCopper.map = sp ? spangleTex() : null; matCopper.roughnessMap = sp ? spangleTex() : groove; matCopper.bumpMap = sp ? null : groove;
  matCopper.roughness = Math.min(1, m.rough*1.5); matCopper.needsUpdate = true;   // ×1,5 compensa o mapa de rugosidade (média ≈ 0,7)
  $('specDisc').textContent = `${m.name} · ${DISC_TXT}`;
  const d50 = 1e3/Math.sqrt(Math.PI*50*4e-7*Math.PI*m.mur*m.sigma);   // δ = 1/√(π·f·μ0·μr·σ) a 50 Hz (mm)
  $('matInfo').textContent = `σ ${(m.sigma/1e6).toFixed(1)} MS/m · μr ${m.mur} · ρ ${m.rho} kg/m³ · c ${m.c} J/kg·K · k ${m.k} W/m·K · pico de torque (CC, 20 °C) ${Math.round(wPeak(k)*30/Math.PI)} rpm · δ(50 Hz) ${d50.toFixed(d50 < 1 ? 2 : 1)} mm`
    + (m.ferro ? ` · ferromagnético: entra no circuito magnético (g ${(mp.g*1e3).toFixed(1)} mm, contra ${((CONFIG.phys.geo.gap2 + CONFIG.phys.geo.D)*1e3).toFixed(0)} mm em Cu/Al), efeito pelicular → T ∝ 1/√ω em alta rotação, histerese e atração axial` : '')
    + (m.coat ? ` · camada de ${m.coat.name} ${Math.round(m.coat.t*1e6)} µm/face (σ ${(m.coat.sigma/1e6).toFixed(1)} MS/m) em paralelo` : '');
  circInfo(); }
// circuito magnético: núcleo em C (culatra fecha o fluxo) × sem circuito (2 núcleos polares; o fluxo volta pelo ar)
export function setSpecCore(open){ $('specCore').textContent = open ? 'sem culatra · 2 núcleos polares' : 'C laminado · aço-Si'; }
const MAWb = R => (R/1e6).toFixed(R < 1e7 ? 2 : 1);
function circInfo(){
  const P = CONFIG.phys, mp = matProps(), open = mp.circ === 'open', L = lLin(mp), bh = P.fringe && P.bhCurve;
  const bMax = open ? `perna chega a ${P.geo.bSatFe} T com B ${mp.bSat.toFixed(2)} T no entreferro`
    : bh ? `braço chega a ${P.geo.bSatFe} T com B ${mp.bSat.toFixed(2)} T no entreferro (curva B-H do M400-50A; acima disso o fluxo também volta pelo ar)`
    : P.yokeAir ? `culatra satura em B ${mp.bSat.toFixed(2)} T; acima disso o fluxo volta também pelo ar, até ${mp.bLeg.toFixed(2)} T (pernas)`
    : `B máx. no entreferro ${mp.bSat.toFixed(2)} T`;
  const fr = P.fringe ? ` · franjamento (Roters) F = ${mp.F.toFixed(2)} → polo equivalente Ø${(2*mp.aE*1e3).toFixed(0)} mm` + (open ? '' : ` · ferro + juntas: K_lin = ${mp.kLin.toFixed(3)}`) : '';
  $('circInfo').textContent = `B pico/A ef. ${(mp.bPerA*1e3).toFixed(1)} mT/A · ${bMax}${fr} · relutância: entreferro ${MAWb(mp.Rg)} MA/Wb`
    + (open ? ` + retorno pelo ar ${MAWb(mp.Rx)} MA/Wb → B/A ${Math.round(100*mp.bPerA/matProps(params.mat, 'C').bPerA)} % do núcleo em C` : ' + culatra')
    + ` · L (${P.turns0} esp., sem saturar) ${(L*1e3).toFixed(1)} mH · τ = L/R ${Math.round(tauCoil(mp)*1e3)} ms`
    + (P.coilDyn ? ` (fonte regulada de ${P.coil.vBus} V força a subida; fonte "seca" atrasaria o campo ~τ)` : ' (atraso do campo com fonte de tensão)')
    + ` · bobina: ${P.coil.wire}, janela ${Math.round(P.coil.aWin*1e6)} mm², R20 ${P.coil.R20.toFixed(2)} Ω, ${P.coil.G.toFixed(2)} W/K → ΔT ≈ ${Math.round(P.ratedA**2*P.coil.R20/P.coil.G)} K contínuo no nominal (τ térmico ${Math.round(P.coil.C/P.coil.G/60)} min)`;
}
function setCirc(c){ params.circ = c === 'open' ? 'open' : 'C'; selCirc.value = params.circ; circInfo(); }
selCirc.onchange = () => setCirc(selCirc.value);
selMode.onchange = () => setMode(selMode.value);
selMat.onchange  = () => setMat(selMat.value);
btnDir.onclick   = () => setDir(-params.dir);
selMat.innerHTML = Object.entries(MATS).map(([k,m]) => `<option value="${k}">${m.name}</option>`).join('');

/* ---------- cenários e roteiros ---------- */
const S = {   // números recalculados com o modelo da revisão 3 (6 A nominais, entreferro 1,5 mm, curva B-H, motor 0,55 kW)
  emerg:[{ set:{ n:240, rpm:900, exc:1, f:1.2, mode:'ac', dir:1, mat:'Cu', circ:'C', motor:false, w0:900 },
    text:'Frenagem de emergência: motor desligado (o rotor continua acoplado), disco Ø150 a 900 rpm, 6 A nominais. A fonte regulada estabelece o campo em ~10 ms; sem contato, a velocidade cai à metade em ~0,18 s e fica abaixo de 20 rpm em ~0,3 s; a energia cinética (~12 J) vira calor e aquece o disco só ~0,004 °C. Segure Espaço para excitação total.' }],
  heat:[{ set:{ n:240, rpm:1300, exc:1.5, f:1.2, mode:'ac', dir:1, mat:'Cu', circ:'C', motor:true, w0:1300 },
    text:'Regime contínuo: alvo de 1300 rpm e 9 A (J = 5,4 A/mm², acima do contínuo). O motor de indução escorrega para ~1220 rpm sob ~0,96 N·m. Acima de ωc (~360 rpm) o torque cai com ω e o disco recebe ~120 W, subindo para ~175 W à medida que esquenta (σ cai, ωc sobe): passa de 100 °C em ~4 min (~180 °C em 20 min). A bobina perde 55–86 W com só ~0,27 W/K de troca e passa de 155 °C (classe F) em ~16 min: em 9 A o freio é intermitente.' }],
  dcac:[
    { set:{ n:240, rpm:900, exc:1, f:2, mode:'ac', dir:1, mat:'Cu', circ:'C', motor:true, w0:900 }, text:'1/4 · CA a 2 Hz: o torque pulsa a 2f (traço cinza) e a média vale Tb.' },
    { set:{ mode:'dc' }, text:'2/4 · CC: mesmo valor eficaz, torque constante, sem ondulação.' },
    { set:{ dir:-1 }, text:'3/4 · Sentido reverso (Lenz): o torque continua se opondo ao movimento e as correntes parasitas giram ao contrário.' },
    { set:{ dir:1, mat:'Al' }, text:'4/4 · Alumínio 1050: σ menor → velocidade crítica maior (~575 rpm contra ~350 rpm do cobre; no 6061-T6, ~800 rpm) → freia menos em rotação baixa.' }],
  galv:[
    { set:{ n:240, rpm:900, exc:1, f:1.2, mode:'ac', dir:1, mat:'Cu', circ:'C', motor:true, w0:900 }, text:'1/4 · Cobre, 900 rpm, 6 A em CA: ωc ≈ 360 rpm, então o disco gira no regime indutivo (T cai com ω). O motor escorrega para ~837 rpm: 0,76 N·m, ~66 W no disco.' },
    { set:{ mat:'Galv' }, text:'2/4 · Aço galvanizado, mesmos 6 A: o aço (μr ≈ 200) entra no circuito magnético; o entreferro efetivo cai de 8 para 3 mm e B por ampère sobe ~2,5×, até ~0,85 T de pico (o braço passa do joelho do aço-Si). O efeito pelicular (δ ≈ 1,7 mm) leva o pico de torque para ~3700 rpm: a 900 rpm o aço está no regime resistivo, onde T ∝ σ·d_ef·B², e o B maior compensa o σ 8× menor. Resultado: ~0,74 N·m, quase o mesmo do cobre. Atração ≈ 165 N por face: no circuito série as duas faces se anulam em qualquer posição axial, e a carga vai para os braços do C.' },
    { set:{ mode:'dc', rpm:2400, w0:2400 }, text:'3/4 · CC a 2400 rpm: o cobre está muito acima do pico e cai para ~0,34 N·m; o galvanizado ainda sobe e chega a ~1,2 N·m (o motor escorrega para ~2300 rpm). Com alvo de 300 rpm a ordem se inverte: cobre ~0,97 N·m, galvanizado ~0,44 N·m.' },
    { set:{ mode:'ac', rpm:900, motor:false, w0:900 }, text:'4/4 · Emergência a 900 rpm com galvanizado: metade da velocidade em ~0,2 s e < 20 rpm em ~0,7 s (cobre: 0,18 s e 0,3 s). Em baixa rotação T ∝ σ·d; a histerese (mN·m) ajuda pouco e o zinco (20 µm/face) soma só 2–4 % da condutância.' }],
  circ:[
    { set:{ n:240, rpm:900, exc:1, f:1.2, mode:'ac', dir:1, mat:'Cu', circ:'C', motor:true, w0:900 }, text:'1/2 · Com núcleo em C: a culatra fecha o fluxo e o entreferro (8 mm, ~6,3 MA/Wb já com a franja) domina a relutância. A 6 A em CA: B pico ~0,58 T e 0,76 N·m a ~837 rpm.' },
    { set:{ circ:'open' }, text:'2/2 · Sem circuito magnético (só os 2 núcleos polares): o fluxo volta pelo ar, que soma ~12,6 MA/Wb à relutância → B por ampère cai para ~36 %. A 6 A: B ~0,21 T e ~0,09 N·m (−87 %); em emergência o eixo leva ~2,5 s para ficar abaixo de 20 rpm (0,3 s com o núcleo em C). Com entreferro pequeno a culatra vale muito: só a 4× o nominal (24 A, J 14,5 A/mm²) o aberto chega a ~0,6 T, perto dos 0,82 T do núcleo em C, cujo braço já passou do joelho do aço-Si.' }]
};
let tour = null, idx = 0, tourName = '';
const CAMS = { emerg:['disc'], heat:['disc'], dcac:['overview','coils','disc','disc'], galv:['disc','coils','overview','disc'], circ:['coils','coils'] };
function apply(s){
  if (s.w0 !== undefined) resetSim(s.w0*Math.PI/30);
  if (s.n !== undefined) setRange('inTrn', s.n);
  if (s.rpm !== undefined) setRange('inRpm', s.rpm);
  if (s.exc !== undefined) setRange('inExc', s.exc);
  if (s.f !== undefined) setRange('inFrq', s.f);
  if (s.mode) setMode(s.mode); if (s.dir) setDir(s.dir); if (s.mat) setMat(s.mat); if (s.circ) setCirc(s.circ);
  if (s.motor !== undefined){ $('tMotor').checked = s.motor; $('tMotor').dispatchEvent(new Event('change')); }
}
function show(){ const st = tour[idx]; apply(st.set); flyTo(CAMS[tourName][idx]); $('gTxt').textContent = st.text; $('guide').hidden = false; $('gNext').hidden = idx >= tour.length-1; }
document.querySelectorAll('[data-scn]').forEach(b => b.onclick = () => { tourName = b.dataset.scn; tour = S[tourName]; idx = 0; show(); });
$('gNext').onclick = () => { idx++; show(); };
$('gEnd').onclick  = () => { $('guide').hidden = true; tour = null; };

/* ---------- estado na URL ---------- */
const hashOf = () => '#' + new URLSearchParams({ rpm:params.rpm, exc:params.exc, f:params.freq, n:params.turns, mode:params.mode, dir:params.dir, mat:params.mat, circ:params.circ, motor:+params.motor });
function readHash(){
  const q = new URLSearchParams(location.hash.slice(1)); if (![...q.keys()].length) return;
  const n = k => q.has(k) && isFinite(+q.get(k)) ? +q.get(k) : undefined;
  apply({ n:n('n'), rpm:n('rpm'), exc:n('exc'), f:n('f'), mode:q.get('mode') || undefined, dir:n('dir'), mat:q.get('mat') || undefined, circ:q.get('circ') || undefined, motor:q.has('motor') ? q.get('motor') === '1' : undefined });
}
addEventListener('hashchange', () => { if (location.hash !== hashOf()) readHash(); });
setInterval(() => { const h = hashOf(); if (location.hash !== h) history.replaceState(null, '', h); }, 400);

/* ---------- registro (CSV) e captura ---------- */
const log = []; let lastT = 0, k = 0;
export function record(){                      // chamado a cada passo fixo (120 Hz) → grava a 60 Hz
  if (sim.t < lastT) log.length = 0;           // reset da simulação = nova corrida
  lastT = sim.t;
  if (++k % 2) return;
  log.push([sim.t, sim.I, sim.omega, sim.Tb, sim.P, sim.temp, sim.tTrack, sim.tCoil, sim.V, sim.Pel, Number.isFinite(sim.delta) ? sim.delta*1e3 : -1, sim.Th, sim.Fax]);
  if (log.length > 40000) log.splice(0, 5000);
}
const stamp = () => new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
const tag = () => `${params.mode}_${params.mat}_${params.circ === 'open' ? 'semCirc' : 'nucleoC'}_${params.rpm}rpm_${stamp()}`;   // mat: Cu, Al, Fe, Galv
$('btnCsv').onclick = () => {
  const rows = ['t_s,I_A,omega_rad_s,Tb_N_m,P_W,T_disco_C,T_trilha_C,T_bobina_C,V_ef_V,P_ativa_W,delta_mm(-1=inf),Th_N_m,Fax_N', ...log.map(r => r.map((v,i) => v.toFixed(i === 0 ? 3 : i === 11 ? 6 : 4)).join(','))];
  save(new Blob([rows.join('\n')], { type:'text/csv' }), `foucault_${tag()}.csv`);
};
$('btnPng').onclick = () => {
  render();                                     // desenha e lê o buffer na mesma tarefa (sem preserveDrawingBuffer)
  const src = renderer.domElement, band = 34, c = document.createElement('canvas'); c.width = src.width; c.height = src.height + band;
  const x = c.getContext('2d'); x.drawImage(src, 0, 0); x.fillStyle = '#0f1113'; x.fillRect(0, src.height, c.width, band);
  x.fillStyle = '#e8a15c'; x.font = '13px monospace';
  x.fillText(`${params.mode.toUpperCase()}${params.mode === 'ac' ? ' ' + params.freq.toFixed(1) + ' Hz' : ''} · ${(params.exc*CONFIG.phys.ratedA).toFixed(1)} A ef. · ${params.turns} esp./bobina · ${MATS[params.mat].name} · ${params.circ === 'open' ? 'sem circuito magnético' : 'núcleo em C'} · alvo ${params.rpm} rpm${params.dir < 0 ? ' (reverso)' : ''} · t=${sim.t.toFixed(1)} s · ${Math.round(sim.omega*30/Math.PI)} rpm · ${Math.round(sim.temp)} °C`, 10, src.height + 22);
  c.toBlob(b => save(b, `foucault_${tag()}.png`), 'image/png');
};
$('btnLink').onclick = async () => { const u = location.origin + location.pathname + hashOf(); try { await navigator.clipboard.writeText(u); $('btnLink').textContent = 'LINK COPIADO'; } catch { prompt('Copie o link:', u); } setTimeout(() => $('btnLink').textContent = 'COPIAR LINK', 1500); };

/* ---------- câmera com easing nos cenários ---------- */
const VIEWS = { overview:{ p:[15,4.5,-4.6], t:[0.8,-1.2,1.2] }, coils:{ p:[6.6,2.4,-5.6], t:[2.2,-0.2,-0.4] }, disc:{ p:[3.2,2.4,-10.5], t:[0.6,-0.4,0] }, motor:{ p:[7.5,2.2,12.5], t:[0,-1,7.6] } };
let tw = null;
function flyTo(name, dur = 1.4){ const v = VIEWS[name]; if (!v || !controls.enabled) return; controls.autoRotate = false;
  tw = { t:0, dur, p0:camera.position.clone(), t0:controls.target.clone(), p1:new THREE.Vector3(...v.p), t1:new THREE.Vector3(...v.t) }; }
export function updateCamera(dt){ if (!tw) return; tw.t += dt; const k = Math.min(1, tw.t/tw.dur), e = k < .5 ? 4*k*k*k : 1 - Math.pow(-2*k + 2, 3)/2;
  camera.position.lerpVectors(tw.p0, tw.p1, e); controls.target.lerpVectors(tw.t0, tw.t1, e); if (k >= 1) tw = null; }
controls.addEventListener('start', () => { tw = null; });   // arrastar cancela a animação

/* ---------- áudio: zumbido 100/200/300 Hz (∝ excitação em CA) + ruído de rotação (∝ ω) ---------- */
let ac = null, humG, windG, windF; const humOsc = [];
function startAudio(){
  ac = new (window.AudioContext || window.webkitAudioContext)();
  const master = ac.createGain(); master.gain.value = 0.35; master.connect(ac.destination);
  humG = ac.createGain(); humG.gain.value = 0; humG.connect(master);
  for (const [fq, g] of [[100,1],[200,.5],[300,.25]]){ const o = ac.createOscillator(), gg = ac.createGain(); o.frequency.value = fq; humOsc.push([o, fq/100]); gg.gain.value = g; o.connect(gg).connect(humG); o.start(); }
  const buf = ac.createBuffer(1, ac.sampleRate*2, ac.sampleRate), ch = buf.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random()*2 - 1;
  const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
  windF = ac.createBiquadFilter(); windF.type = 'bandpass'; windF.Q.value = .8; windG = ac.createGain(); windG.gain.value = 0;
  src.connect(windF).connect(windG).connect(master); src.start();
}
export function updateAudio(){
  if (!ac || ac.state !== 'running') return; const t = ac.currentTime, w = Math.min(1, Math.abs(sim.omega)/250);
  for (const [o, h] of humOsc) o.frequency.setTargetAtTime(Math.max(25, 2*params.freq*h), t, .1);   // zumbido = 2f (piso de 25 Hz para ficar audível)
  humG.gain.setTargetAtTime((params.mode === 'ac' ? 0.4 : 0.03)*Math.min(1, sim.Ir/0.6), t, .08);
  windG.gain.setTargetAtTime(w*w*.5, t, .1); windF.frequency.setTargetAtTime(150 + 1800*w, t, .1);
}
$('tSound').onchange = e => { if (e.target.checked){ if (!ac) startAudio(); ac.resume(); } else if (ac) ac.suspend(); };

export function initFeatures(){ paintLegends(); setMode(params.mode); setDir(params.dir); setMat(params.mat); setCirc(params.circ); readHash(); }
