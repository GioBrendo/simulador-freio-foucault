import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { sim, params, view, step, turnsRatio, peakB, bOf, curveNow, torqueAt, resetTemp, matProps, stopTime } from './physics.js';
import { setSpecCore } from './features.js';
import { renderer, scene, camera, controls, camFrom, camTo, fx, isSmall, render, resizeGL, setShadowQuality } from './scene.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { initFeatures, record, updateAudio, updateCamera, INFERNO_GLSL } from './features.js';
import { matSteel, matCore, matCast, matCopper, matCoil, matBrass, matRubber, matPhen, matFloor, stripeBase, texN, texS, plateTexture } from './materials.js';
const rbox = (w, h, d, r, s = 3) => new RoundedBoxGeometry(w, h, d, s, r);
// RoundedBoxGeometry é não indexada; mergeGeometries exige todas indexadas ou todas não → uniformiza antes de fundir
const mergeMixed = gs => { const g = mergeGeometries(gs.map(x => x.index ? x.toNonIndexed() : x)); if (!g) throw new Error('mergeGeometries falhou (atributos incompatíveis)'); return g; };   // arestas com bisel: captam highlights

const { Rv:R, Tv:T, gap:GAP, mm:MM } = CONFIG.disc;
const DISC_TXT = `Ø${Math.round(CONFIG.disc.R*200)} × ${+(CONFIG.disc.T*100).toFixed(1)} mm`;
const DY = 0.55 - (T/2 + GAP);   // deslocamento axial: faces polares (0,55 no desenho de referência) descem até T/2 + entreferro
const mmOf = u => Math.round(u*MM), BOLT = [3,4,5,6,8,10,12,16].find(b => b >= 0.18*MM);   // cotas das peças mecânicas em mm reais
// núcleo e bobinas (CONFIG.core, unidades de cena; y = eixo da bobina a partir do plano médio do disco, ANTES de descontar DY)
const K = CONFIG.core, IA = CONFIG.phys.ratedA, COILP = CONFIG.phys.coil;
const Y_SHOE = 0.55 + K.shoeT, Y_ARM0 = Y_SHOE + K.legL, Y_ARM = Y_ARM0 + K.limbT/2, Y_TOP = Y_ARM0 + K.limbT;   // sapata→perna, face interna e centro do braço, topo
const Y_FL1 = Y_SHOE + 0.065, Y_FL2 = Y_FL1 + K.flange + K.coilH, Y_CMID = (Y_FL1 + Y_FL2)/2;              // flanges da bobina e centro do enrolamento
const X_COL = K.colX0 + K.limbT/2, X_ARM0 = -(K.legR + 0.08), X_ARM1 = K.colX0 + K.limbT;                 // coluna (centro) e extensão dos braços
const COIL_TXT = `${CONFIG.phys.turns0} espiras · ${COILP.wire} · ${IA} A ef.`;
const C_AMBER = new THREE.Color(0xffb454), C_CYAN = new THREE.Color(0x63c7d6);

/* ============================================================ geometry helpers */
function rrPoint(u, hx, hy, r){                       // point on rounded-rect perimeter, u∈[0,1)
  const ex = hx - r, ey = hy - r;
  const P = 4*ex + 4*ey + 2*Math.PI*r;
  let s = (((u % 1) + 1) % 1) * P;
  if (s < 2*ey)                 return { x: hx, y: -ey + s };           s -= 2*ey;
  if (s < Math.PI*r/2){ const a = s/r;               return { x: ex + r*Math.cos(a),      y: ey + r*Math.sin(a) }; } s -= Math.PI*r/2;
  if (s < 2*ex)                 return { x: ex - s, y: hy };           s -= 2*ex;
  if (s < Math.PI*r/2){ const a = Math.PI/2 + s/r;   return { x: -ex + r*Math.cos(a),     y: ey + r*Math.sin(a) }; } s -= Math.PI*r/2;
  if (s < 2*ey)                 return { x: -hx, y: ey - s };           s -= 2*ey;
  if (s < Math.PI*r/2){ const a = Math.PI + s/r;     return { x: -ex + r*Math.cos(a),     y: -ey + r*Math.sin(a) }; } s -= Math.PI*r/2;
  if (s < 2*ex)                 return { x: -ex + s, y: -hy };           s -= 2*ex;
  const a = 1.5*Math.PI + s/r;
  return { x: ex + r*Math.cos(a), y: -ey + r*Math.sin(a) };
}
class RectHelix extends THREE.Curve{
  constructor(hx,hy,cr,cy,z0,z1,turns){ super(); this.hx=hx; this.hy=hy; this.cr=cr; this.cy=cy; this.z0=z0; this.z1=z1; this.turns=turns; }
  getPoint(t, tgt = new THREE.Vector3()){
    const p = rrPoint(this.turns*t, this.hx, this.hy, this.cr);
    return tgt.set(p.x, p.y + this.cy, this.z0 + (this.z1 - this.z0)*t);
  }
}

const pickables = [];
const PARTS = {
  disc:  ['DISCO CONDUTOR',`Cu · ${DISC_TXT} · correntes de Foucault → calor`],
  hub:   ['CUBO E FURAÇÃO',`6 × M${BOLT} em Ø${mmOf(1.16)} · chavetado ao eixo`],
  shaft: ['EIXO DE ACIONAMENTO',`Ø${mmOf(0.68)} aço · 2 mancais de rolamento`],
  coilA: ['BOBINA A (FRONTAL)',`${COIL_TXT} CA · ∥ ao disco`],
  coilB: ['BOBINA B (TRASEIRA)',`${CONFIG.phys.turns0} espiras Cu · em série (aditiva) · ∥ ao disco`],
  coreA: ['NÚCLEO EM C LAMINADO',`aço-Si M400-50A · braço ${mmOf(K.limbT)} × ${mmOf(K.limbW)} mm · entreferros de ${(GAP*MM).toFixed(1)} mm`],
  poles: ['NÚCLEOS POLARES',`aço-Si · perna Ø${mmOf(2*K.legR)} mm + sapata Ø${mmOf(2*K.shoeR)} mm · dentro das bobinas`],
  ped:   ['MANCAL COM ROLAMENTO','suporte trapezoidal · rolamento rígido de esferas · graxa vedada'],
  motor: ['MOTOR DE ACIONAMENTO','assíncrono trifásico · carcaça aletada · mantém a velocidade alvo'],
  coup:  ['ACOPLAMENTO FLEXÍVEL','garras + elastômero · absorve desalinhamento motor–eixo'],
  msup:  ['SUPORTE DO MOTOR','4 pernas soldadas à base'],
  csup:  ['SUPORTE DAS BOBINAS','perfil em T · fixado na base · eixo das bobinas ∥ ao eixo, a 55 mm dele'],
  base:  ['BASE DE FIXAÇÃO','estrutura de aço soldada'],
  feed:  ['CAIXA DE ALIMENTAÇÃO CA','2 fios blindados · alimentação das bobinas'],
};
function tag(mesh, part){ mesh.userData.part = part; pickables.push(mesh); return mesh; }

/* ============================================================ static scene */
{ // floor + polar grid
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 64), matFloor);
  floor.rotation.x = -Math.PI/2; floor.position.y = -5.3; floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.PolarGridHelper(26, 12, 6, 64, 0x2c3138, 0x22262b);
  grid.position.y = -5.28;
  grid.material.transparent = true; grid.material.opacity = 0.55;
  scene.add(grid);
}
// Arranjo do desenho suporte.png: motor (à esquerda na vista frontal, +z) → acoplamento → eixo em 2 mancais com rolamento → disco no meio;
// bobinas (com o núcleo em C) sobre suportes em T, dos dois lados do disco. Eixo das bobinas ∥ ao eixo do motor e DESLOCADO (x = poleX):
// bobina coaxial ao eixo daria campo axissimétrico → as correntes parasitas não fecham laço → torque nulo.
const YB = -5.045, ZB0 = -4.8, ZB1 = 10.6, ZBC = (ZB0 + ZB1)/2;   // YB: topo da base; base vai do mancal traseiro ao motor
const ZM = 8.0, ZCP = 5.75, PED_Z = [3.6, -3.6];                   // centro do motor, acoplamento, mancais
const matMotor = new THREE.MeshStandardMaterial({ color:0x34495a, metalness:0.55, roughness:0.5 });
const V3 = (x,y,z)=>new THREE.Vector3(x,y,z);
const YUP0 = new THREE.Vector3(0,1,0);
function strut(a, b, t, mat, part){                                // barra quadrada de a até b
  const d = new THREE.Vector3().subVectors(b, a), m = tag(new THREE.Mesh(new THREE.BoxGeometry(t, d.length(), t), mat), part);
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(YUP0, d.normalize());
  m.castShadow = m.receiveShadow = true; scene.add(m); return m;
}
const lathe = (r0, r1, w, seg = 48)=>{ const g = new THREE.LatheGeometry([[r0,-w/2],[r1,-w/2],[r1,w/2],[r0,w/2],[r0,-w/2]].map(p => new THREE.Vector2(...p)), seg);
  g.rotateX(Math.PI/2); return g; };                               // anel coaxial ao eixo z
{ // base plate
  const m = matCast.clone();
  const base = tag(new THREE.Mesh(rbox(11, 0.45, ZB1 - ZB0, 0.05), m), 'base');
  base.position.set(0, -5.27, ZBC); base.castShadow = base.receiveShadow = true;
  scene.add(base);
  const bg = new THREE.CylinderGeometry(0.13, 0.13, 0.12, 12);
  for (const x of [4.9, -4.9]) for (const z of [ZB0 + 0.7, ZBC, ZB1 - 0.7]){
    const b = new THREE.Mesh(bg, matSteel.clone()); b.position.set(x, -5.0, z); scene.add(tag(b,'base'));
  }
}
const cages = [];
{ // mancais: suporte trapezoidal com topo arredondado + rolamento rígido de esferas (anel externo fixo, esferas na gaiola a ~0,4·ω)
  const sh = new THREE.Shape(), hb = 1.45, ht = 0.95;
  sh.moveTo(-hb, YB); sh.lineTo(hb, YB); sh.lineTo(ht, 0); sh.absarc(0, 0, ht, 0, Math.PI, false); sh.lineTo(-hb, YB);
  const hole = new THREE.Path(); hole.absarc(0, 0, 0.6, 0, Math.PI*2, true); sh.holes.push(hole);
  const pg = new THREE.ExtrudeGeometry(sh, { depth:0.5, bevelEnabled:true, bevelThickness:0.04, bevelSize:0.04, bevelSegments:2, curveSegments:40 });
  pg.translate(0, 0, -0.25);
  const ballG = new THREE.SphereGeometry(0.075, 14, 10), outerG = lathe(0.47, 0.6, 0.46), innerG = lathe(0.34, 0.39, 0.46);
  for (const zc of PED_Z){
    const m = matCast.clone();
    const body = tag(new THREE.Mesh(pg, m), 'ped'); body.position.z = zc; body.castShadow = body.receiveShadow = true; scene.add(body);
    const foot = tag(new THREE.Mesh(rbox(3.4, 0.14, 1.2, 0.03), m), 'ped'); foot.position.set(0, YB + 0.07, zc); foot.receiveShadow = true; scene.add(foot);
    for (const xs of [1.3, -1.3]){ const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.16, 10), matSteel.clone()); bolt.position.set(xs, YB + 0.2, zc); scene.add(tag(bolt,'ped')); }
    const outer = tag(new THREE.Mesh(outerG, matSteel.clone()), 'ped'); outer.position.z = zc; scene.add(outer);
    const cage = new THREE.Group(); cage.position.z = zc; scene.add(cage); cages.push(cage);
    for (let i = 0; i < 10; i++){ const ball = new THREE.Mesh(ballG, matSteel); ball.position.set(0.43*Math.cos(i*Math.PI/5), 0.43*Math.sin(i*Math.PI/5), 0); cage.add(ball); }
    cage.userData.inner = innerG;
  }
}
{ // suporte do motor: chapa + 4 pernas inclinadas soldadas à base (como no desenho), com travessas
  const m = matCast.clone();
  const plate = tag(new THREE.Mesh(rbox(2.7, 0.14, 3.0, 0.03), m), 'msup'); plate.position.set(0, -1.37, ZM); plate.castShadow = plate.receiveShadow = true; scene.add(plate);
  for (const sx of [1, -1]) for (const sz of [1, -1]){
    strut(V3(sx*1.15, -1.42, ZM + sz*1.25), V3(sx*1.75, YB, ZM + sz*1.6), 0.2, m, 'msup');
    const pad = tag(new THREE.Mesh(rbox(0.5, 0.08, 0.5, 0.02), m), 'msup'); pad.position.set(sx*1.75, YB + 0.04, ZM + sz*1.6); scene.add(pad);
  }
  for (const sx of [1, -1]) strut(V3(sx*1.5, -3.4, ZM - 1.45), V3(sx*1.5, -3.4, ZM + 1.45), 0.12, m, 'msup');
  for (const sz of [1, -1]) strut(V3(-1.5, -3.4, ZM + sz*1.45), V3(1.5, -3.4, ZM + sz*1.45), 0.12, m, 'msup');
}
let motorLed;
{ // motor de indução: carcaça aletada, tampas, tampa da ventoinha, caixa de ligação, placa e pés
  const L = 2.8, z0 = ZM - L/2, z1 = ZM + L/2;
  const body = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.02, L, 40), matMotor), 'motor');
  body.rotation.x = Math.PI/2; body.position.z = ZM; body.castShadow = body.receiveShadow = true; scene.add(body);
  const fg = [];
  for (let i = 0; i < 24; i++){ const a = i*Math.PI/12; if (Math.abs(Math.sin(a) + 1) < 0.25) continue;   // sem aletas embaixo (pés)
    const f = new THREE.BoxGeometry(0.06, 0.2, L - 0.3); f.rotateZ(a - Math.PI/2); f.translate(1.1*Math.cos(a), 1.1*Math.sin(a), ZM); fg.push(f); }
  const fins = tag(new THREE.Mesh(mergeGeometries(fg), matMotor), 'motor'); fins.castShadow = true; scene.add(fins);
  for (const z of [z0 - 0.1, z1 + 0.1]){ const e = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.14, 1.14, 0.22, 40), matMotor), 'motor');
    e.rotation.x = Math.PI/2; e.position.z = z; e.castShadow = true; scene.add(e); }
  const fan = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.06, 0.75, 40), matCast.clone()), 'motor');
  fan.rotation.x = Math.PI/2; fan.position.z = z1 + 0.58; fan.castShadow = true; scene.add(fan);
  const gr = [];   // grade da tampa da ventoinha: anéis concêntricos
  for (const r of [0.3, 0.55, 0.8]) { const t = new THREE.TorusGeometry(r, 0.03, 6, 40); t.translate(0, 0, z1 + 0.97); gr.push(t); }
  scene.add(new THREE.Mesh(mergeGeometries(gr), matRubber));
  const tb = tag(new THREE.Mesh(rbox(0.85, 0.5, 0.95, 0.05), matMotor), 'motor'); tb.position.set(0, 1.32, ZM - 0.4); tb.castShadow = true; scene.add(tb);
  const feet = tag(new THREE.Mesh(rbox(2.2, 0.28, 2.3, 0.04), matMotor), 'motor'); feet.position.set(0, -1.16, ZM); feet.castShadow = true; scene.add(feet);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), new THREE.MeshBasicMaterial({ map:plateTexture('MOTOR') }));
  plate.position.set(1.23, 0.0, ZM - 0.2); plate.rotation.y = Math.PI/2; scene.add(plate);
  motorLed = new THREE.MeshStandardMaterial({ color:0x1a2a1a, emissive:0x7dff9a, emissiveIntensity:0.1 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), motorLed); led.position.set(0.3, 1.6, ZM - 0.4); scene.add(led);
}
{ // suportes em T das bobinas (desenho: "suporte para bobinas"): poste da base até logo abaixo de cada bobina + mesa de apoio
  const m = matCast.clone();
  for (const s of [1, -1]){
    const zc = s*(Y_CMID - DY), top = -(K.flangeR + 0.06);   // sob o centro de cada bobina, logo abaixo da flange
    const post = tag(new THREE.Mesh(rbox(0.22, top - YB, 0.22, 0.03), m), 'csup'); post.position.set(CONFIG.poleX, (top + YB)/2, zc); post.castShadow = post.receiveShadow = true; scene.add(post);
    const head = tag(new THREE.Mesh(rbox(1.3, 0.1, 0.6, 0.03), m), 'csup'); head.position.set(CONFIG.poleX, top + 0.03, zc); head.castShadow = true; scene.add(head);
    const foot = tag(new THREE.Mesh(rbox(0.8, 0.08, 0.6, 0.02), m), 'csup'); foot.position.set(CONFIG.poleX, YB + 0.04, zc); scene.add(foot);
  }
}

/* ============================================================ rotating groups */
let coreCol;   // coluna de apoio do núcleo em C (some sem o circuito magnético)
{ // coluna de apoio do núcleo em C
  const col = tag(new THREE.Mesh(rbox(Math.max(0.7, K.limbT + 0.3), 4.6, 1.2, 0.05), matCast.clone()), 'base');
  col.position.set(CONFIG.poleX + X_COL, -2.8, 0); col.castShadow = col.receiveShadow = true; scene.add(col); coreCol = col;
}
const shaftGroup = new THREE.Group(); scene.add(shaftGroup);
{
  const SZ0 = -4.5, SZ1 = ZCP - 0.2;   // eixo: do colar traseiro até o cubo do acoplamento
  const shaft = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, SZ1 - SZ0, 28), matSteel.clone()), 'shaft');
  shaft.rotation.x = Math.PI/2; shaft.position.z = (SZ0 + SZ1)/2; shaft.castShadow = true; shaft.material.roughness = 0.45;   // retificado, sem espelhar a luz principal
  shaftGroup.add(shaft);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 7.4),
    new THREE.MeshStandardMaterial({ color:0x24262a, roughness:0.6, metalness:0.4 }));
  stripe.position.y = 0.355; shaftGroup.add(stripe);
  for (const zc of [4.0, -4.0]){
    const hubc = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.7, 28), matSteel.clone()), 'shaft');
    hubc.rotation.x = Math.PI/2; hubc.position.z = zc; hubc.castShadow = true;
    shaftGroup.add(hubc);
    for (let i=0;i<6;i++){
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 10), matSteel.clone());
      b.rotation.x = Math.PI/2;
      b.position.set(Math.cos(i*Math.PI/3)*0.36, Math.sin(i*Math.PI/3)*0.36, zc);
      shaftGroup.add(tag(b,'shaft'));
    }
  }
  for (const c of cages){ const inner = tag(new THREE.Mesh(c.userData.inner, matSteel.clone()), 'ped'); inner.position.z = c.position.z; shaftGroup.add(inner); }   // pista interna gira com o eixo
  // acoplamento flexível: 2 cubos de aço com garras + aranha de elastômero; ponta do eixo do motor
  for (const z of [ZCP - 0.32, ZCP + 0.32]){ const h = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.42, 32), matSteel.clone()), 'coup');
    h.rotation.x = Math.PI/2; h.position.z = z; h.castShadow = true; shaftGroup.add(h); }
  const spider = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.22, 6), new THREE.MeshStandardMaterial({ color:0xc2611f, roughness:0.8, metalness:0.05 })), 'coup');
  spider.rotation.x = Math.PI/2; spider.position.z = ZCP; shaftGroup.add(spider);
  const stub = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.0, 20), matSteel.clone()), 'coup');
  stub.rotation.x = Math.PI/2; stub.position.z = ZCP + 0.85; shaftGroup.add(stub);
}

const discGroup = new THREE.Group(); scene.add(discGroup);
const discMat = matCopper;
{
  const disc = tag(new THREE.Mesh(new THREE.CylinderGeometry(R, R, T, 96), discMat), 'disc');
  disc.rotation.x = Math.PI/2; disc.castShadow = disc.receiveShadow = true;
  discGroup.add(disc);
  const hub = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.95, 48), matCast.clone()), 'hub');
  hub.rotation.x = Math.PI/2; hub.castShadow = true;
  discGroup.add(hub);
  for (let i=0;i<6;i++){
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.06, 10), matSteel.clone());
    b.rotation.x = Math.PI/2;
    b.position.set(Math.cos(i*Math.PI/3)*0.58, Math.sin(i*Math.PI/3)*0.58, 0);
    discGroup.add(tag(b,'hub'));
  }
}

/* ---- mapa de calor: 100% em fragment shader (sem canvas, sem upload CPU→GPU) ---- */
const uHM = { value:0 }, uBase = { value:0 }, heatMats = [];
const uHeat = { phi:{ value:0 }, om:{ value:0 }, eN:{ value:0 }, temp:{ value:28 }, trk:{ value:0 } };
const JET = INFERNO_GLSL;   // paleta inferno (perceptualmente uniforme) no lugar do jet
// Rastro analítico: o polo fixo no mundo varre o disco a -phi; o ponto a "lag" rad atrás foi aquecido há lag/ω s
// e decai com exp(-idade/τ). A soma de todas as voltas é uma série geométrica (forma fechada).
const HEAT_GLSL = `
float heatI(vec2 p){
  vec2 q = vec2(p.x, p.y*uFlip);
  float rho = length(q), sg = uOm < 0. ? -1. : 1., lag = mod(sg*(atan(q.y, q.x) + uPhi), 6.2831853);
  float sl = lag > 3.1415927 ? lag - 6.2831853 : lag;
  float rp = ${CONFIG.poleX.toFixed(3)}, sig = 0.45*(0.37 + 0.57*uEN);
  float dr = (rho - rp)/sig, rad = exp(-dr*dr);
  float a = min(0.35, uEN*0.2), en = smoothstep(0.02, 0.05, uEN);
  float om = max(abs(uOm), 0.3), wt = om*${CONFIG.heat.tau.toFixed(2)};
  float dep = (a/0.033)*1.7725*sig/(rp*om);
  float trail = dep*exp(-lag/wt)/(1. - exp(-6.2831853/wt));
  float ha = rp*sl/sig, hd = 3.*a*exp(-ha*ha);
  float v = 1. - exp(-(trail + hd)*rad*en);
  float g = clamp((uTemp - 140.)/260., 0., 1.), dg = (rho - 2.8)/0.3;
  return clamp(v + 0.7*g*exp(-dg*dg), 0., 1.);
}`;
const HEAT_FRAG = `#include <map_fragment>
float hv = heatI(vHp);
if (uHM > .5){ float h = clamp((uTemp - ${CONFIG.phys.ambient.toFixed(1)} + uTrk*sqrt(hv))/${(CONFIG.heat.tMax-CONFIG.phys.ambient).toFixed(1)}, 0., 1.);
  diffuseColor = vec4(pow(pal(h), vec3(2.2))*(1. + .8*hv), smoothstep(.015, .1, h)); }
else diffuseColor = vec4(mix(vec3(.47,.08,0.), vec3(1.,.85,.6), hv)*hv, 1.);`;
function mkHeatMat(flip){
  const m = new THREE.MeshBasicMaterial({ transparent:true, blending:THREE.AdditiveBlending, depthWrite:false,
    polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2 });
  m.onBeforeCompile = sh =>{
    Object.assign(sh.uniforms, { uHM, uBase, uPhi:uHeat.phi, uOm:uHeat.om, uEN:uHeat.eN, uTemp:uHeat.temp, uTrk:uHeat.trk, uFlip:{ value:flip } });
    sh.vertexShader = 'varying vec2 vHp;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHp = position.xy;');
    sh.fragmentShader = 'varying vec2 vHp;\nuniform float uHM,uBase,uPhi,uOm,uEN,uTemp,uTrk,uFlip;\n' + JET + HEAT_GLSL +
      sh.fragmentShader.replace('#include <map_fragment>', HEAT_FRAG);
  };
  heatMats.push(m); return m;
}
for (const [flip, z, rx] of [[1, T/2 + CONFIG.heat.lift, 0], [-1, -T/2 - CONFIG.heat.lift, Math.PI]]){
  const ov = new THREE.Mesh(new THREE.CircleGeometry(R-0.01, 96), mkHeatMat(flip));
  ov.position.z = z; ov.rotation.x = rx; ov.renderOrder = 1;
  discGroup.add(ov);
}

/* ============================================================ coil units */
const XP = CONFIG.poleX;                                // raio do eixo dos polos (mundo, +x)
const coneGeo = new THREE.ConeGeometry(0.06, 0.17, 10);
const ringGeo = (rad, tube, y, rs = 8, ts = 56)=>{
  const t = new THREE.TorusGeometry(rad, tube, rs, ts);
  t.rotateX(-Math.PI/2); t.translate(0, y, 0);   // anel paralelo ao disco; +u = anti-horário visto de frente
  return t;
};
function lamBox(sx, sy, sz, cx, cy){             // bloco laminado: 10 lâminas ao longo de z
  const gs = [];
  for (let i=0;i<10;i++){ const b = rbox(sx, sy, sz*0.086, 0.012, 2); b.translate(cx, cy, -sz/2 + sz*0.1*(i+0.5)); gs.push(b); }
  return gs;
}
function buildUnit(){
  const u = { sign:1, group:new THREE.Group(), swirls:[], mix:1 };
  const g = u.group;

  /* núcleo em C laminado = culatra (braços à frente/atrás do disco + coluna externa) + núcleos polares (pernas com sapatas).
     Sem circuito magnético só os núcleos polares ficam: o fluxo volta pelo ar. */
  // dimensões em CONFIG.core (braço/coluna limbT × limbW; perna legR × legL; sapata shoeR × shoeT): a física tira daqui seções e caminhos
  const AW = X_ARM1 - X_ARM0, AX = (X_ARM0 + X_ARM1)/2;
  const cg = [...lamBox(AW,K.limbT,K.limbW, AX, Y_ARM-DY), ...lamBox(AW,K.limbT,K.limbW, AX,-(Y_ARM-DY)), ...lamBox(K.limbT,2*(Y_TOP-DY),K.limbW, X_COL, 0)], pg = [];
  for (const s of [1,-1]){
    const p = new THREE.CylinderGeometry(K.legR,K.legR,K.legL,32); p.translate(0, s*(Y_SHOE + K.legL/2 - DY), 0); pg.push(p);
    const h = new THREE.CylinderGeometry(K.shoeR,K.shoeR,K.shoeT,40); h.translate(0, s*(0.55 + K.shoeT/2 - DY), 0); pg.push(h);
  }
  u.yoke = tag(new THREE.Mesh(mergeMixed(cg), matCore.clone()), 'coreA');
  u.poles = tag(new THREE.Mesh(mergeGeometries(pg), matCore.clone()), 'poles');
  for (const m of [u.yoke, u.poles]){ m.castShadow = m.receiveShadow = true; g.add(m); }

  /* bobinas A (à frente) e B (atrás): anéis na janela de enrolamento (coilRi…coilRo × coilH), planos paralelos ao disco */
  u.coilMat = matCoil.clone();
  // cada anel representa N/M espiras; grade radial (L) × axial (Ka) dentro da janela; o raio do tubo cresce com o passo
  const R0 = K.coilRi + 0.05, DR = K.coilRo - 0.05 - R0, Z0 = Y_FL1 + K.flange/2 + 0.04, DZ = K.coilH - 0.08;
  const mk = (s, ex, n = CONFIG.phys.turns0)=>{ const M = Math.max(4, Math.round(30*n/CONFIG.phys.turns0)), L = Math.max(1, Math.round(Math.sqrt(M*DR/DZ))), Ka = Math.max(2, Math.round(M/L));
    const pr = L > 1 ? DR/(L-1) : 0, pz = DZ/(Ka-1), rw = Math.min(0.07, 0.45*Math.min(pr || 1, pz)), gs = [];
    for (let r=0;r<L;r++) for (let k=0;k<Ka;k++) gs.push(ringGeo(R0 + (L > 1 ? pr*r : DR/2), rw + ex, s*(Z0 - DY + pz*k), 8, 48));
    return mergeGeometries(gs); };
  const coilA = tag(new THREE.Mesh(mk( 1,0), u.coilMat), 'coilA');
  const coilB = tag(new THREE.Mesh(mk(-1,0), u.coilMat), 'coilB');
  coilA.castShadow = coilB.castShadow = true; g.add(coilA, coilB);
  const fl = [];
  for (const s of [1,-1]) for (const y of [Y_FL1-DY,Y_FL2-DY]){ const f = new THREE.CylinderGeometry(K.flangeR,K.flangeR,K.flange,40); f.translate(0, s*y, 0); fl.push(f); }
  g.add(new THREE.Mesh(mergeGeometries(fl), matPhen));

  /* campo E nas bobinas: ao longo do fio, no sentido da corrente */
  u.coilOvTex = stripeBase.clone(); u.coilOvTex.repeat.set(3,1);
  u.coilOvMat = new THREE.MeshBasicMaterial({ color:0xc79bff, transparent:true, opacity:0,
    blending:THREE.AdditiveBlending, depthWrite:false, alphaMap:u.coilOvTex });
  u.coilOvMesh = new THREE.Mesh(mergeGeometries([mk(1,0.009), mk(-1,0.009)]), u.coilOvMat);
  u.coilOvMesh.renderOrder = 2; g.add(u.coilOvMesh);
  u.setTurns = n =>{ for (const [mesh, s] of [[coilA, 1], [coilB, -1]]){ mesh.geometry.dispose(); mesh.geometry = mk(s, 0, n); }
    u.coilOvMesh.geometry.dispose(); u.coilOvMesh.geometry = mergeGeometries([mk(1, 0.009, n), mk(-1, 0.009, n)]); };

  /* campo E induzido no disco: anéis em torno do eixo de B (faces e plano médio), E = −∂A/∂t */
  const eg = [];
  for (const y of [T/2+0.02, 0, -T/2-0.02]) for (const rr of [0.28, 0.5, 0.72]) eg.push(ringGeo(rr, 0.022, y, 6, 72));
  u.eTex = stripeBase.clone(); u.eTex.repeat.set(3,1);
  u.eMat = new THREE.MeshBasicMaterial({ color:0xc79bff, transparent:true, opacity:0,
    blending:THREE.AdditiveBlending, depthWrite:false, depthTest:false, alphaMap:u.eTex });
  u.eMesh = new THREE.Mesh(mergeGeometries(eg), u.eMat); u.eMesh.renderOrder = 4; u.eMesh.position.y = CONFIG.overlayOffset; g.add(u.eMesh);

  /* correntes parasitas por movimento (dois lóbulos contrarrotativos por face do disco) */
  u.swirlMat = new THREE.MeshBasicMaterial({ color:0xffb454, transparent:true, opacity:0,
    blending:THREE.AdditiveBlending, depthWrite:false });
  const ARC = Math.PI*1.8;
  const tanV = new THREE.Vector3(-Math.sin(ARC), Math.cos(ARC), 0).normalize();
  const YUP = new THREE.Vector3(0,1,0);
  for (const face of [1,-1]) for (const dir of [1,-1]){
    const w = new THREE.Group(); w.rotation.x = -Math.PI/2; w.position.set(0, face*(T/2+0.04), dir*0.36);
    const arc = new THREE.Group();
    const tor = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.030, 8, 64, ARC), u.swirlMat);
    const cone = new THREE.Mesh(coneGeo, u.swirlMat);
    cone.position.set(0.30*Math.cos(ARC), 0.30*Math.sin(ARC), 0);
    cone.quaternion.setFromUnitVectors(YUP, tanV);
    arc.add(tor, cone); arc.userData.dir = dir; arc.scale.y = dir;   // mesma circulação nas duas faces (J atravessa a espessura); a seta acompanha o giro arc.renderOrder = 3;
    w.add(arc); g.add(w); u.swirls.push(arc);
  }

  /* campo B: 9 circuitos fechados (atravessam bobinas, entreferros e disco; vazam além do núcleo) */
  const yy = y => Math.sign(y)*(Math.abs(y) >= 0.55 ? Math.abs(y) - DY : Math.abs(y)*(0.55 - DY)/0.55);   // linhas de campo acompanham o novo entreferro
  const fg = [], yL = Y_SHOE + 0.58*K.legL, yAi = Y_ARM - 0.13, xC = X_COL + 0.02, yC = Y_ARM - 0.35;   // meio da perna, entrada do braço, coluna
  for (const zk of [-0.3, 0, 0.3]) for (const xo of [-0.26, 0, 0.26]){
    const pts = [[xo,yL],[xo,0.55],[xo*1.5,0],[xo,-0.55],[xo,-yL],[0.5*xo+0.2,-yAi],[0.9,-Y_ARM],[K.colX0,-Y_ARM],
      [xC,-yC],[xC,0],[xC,yC],[K.colX0,Y_ARM],[0.9,Y_ARM],[0.5*xo+0.2,yAi]].map(a=>new THREE.Vector3(a[0], yy(a[1]), zk));
    fg.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.65), 220, 0.024, 5, true));
  }
  u.fieldTex = stripeBase.clone(); u.fieldTex.repeat.set(3,1);
  u.fieldMat = new THREE.MeshBasicMaterial({ color:0xffb454, transparent:true, opacity:0,
    blending:THREE.AdditiveBlending, depthWrite:false, depthTest:false, alphaMap:u.fieldTex });
  u.fieldC = new THREE.Mesh(mergeGeometries(fg), u.fieldMat);
  /* sem circuito magnético: laços "de dipolo" — atravessam núcleos, entreferros e disco e voltam pelo ar, dos dois lados */
  const fo = [], Yf = 0.55 - DY, Y1 = Y_ARM0 - DY + 0.12, XO = K.flangeR + 0.35;   // laços por fora das bobinas
  for (const sg of [1, -1]) for (const zk of [-0.3, 0, 0.3]) for (const xo of [-0.26, 0, 0.26]){
    const pts = [[xo,Y1],[xo,Yf+0.3],[xo*1.4,0],[xo,-(Yf+0.3)],[xo,-Y1],[sg*0.5,-(Y1+0.32)],[sg*(XO-0.35),-(Y1-0.05)],[sg*XO,0],[sg*(XO-0.35),Y1-0.05],[sg*0.5,Y1+0.32]]
      .map(a => new THREE.Vector3(a[0], a[1], zk));
    fo.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.65), 160, 0.02, 5, true));
  }
  u.fieldO = new THREE.Mesh(mergeGeometries(fo), u.fieldMat);
  for (const m of [u.fieldC, u.fieldO]){ m.renderOrder = 4.5; m.position.y = -CONFIG.overlayOffset; m.visible = false; g.add(m); }
  u.fieldMesh = u.fieldC;
  u.setCirc = open =>{ u.yoke.visible = !open; u.fieldMesh = open ? u.fieldO : u.fieldC; (open ? u.fieldC : u.fieldO).visible = false; };

  /* selos N / S nas faces polares (F = traseira, B = frontal) */
  const mkSprite = ()=>{ const s = new THREE.Sprite(new THREE.SpriteMaterial({ map:texN, transparent:true, opacity:0 }));
    s.scale.setScalar(0.52); s.userData = { pop:0, L:'N' }; s.renderOrder = 5; return s; };
  u.sprF = mkSprite(); u.sprF.position.set(-0.95, -(0.63-DY), 0); g.add(u.sprF);
  u.sprB = mkSprite(); u.sprB.position.set(-0.95,  0.63-DY, 0); g.add(u.sprB);
  return u;
}
const unitA = buildUnit();
unitA.group.position.set(XP, 0, 0); unitA.group.rotation.x = Math.PI/2; scene.add(unitA.group);
const units = [unitA];
const uB = { value:0 };
const bMat = new THREE.ShaderMaterial({ uniforms:{ uB }, transparent:true, depthWrite:false, side:THREE.DoubleSide,
  vertexShader:'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: JET + 'uniform float uB; varying vec2 vUv; void main(){ float r=length((vUv-.5)*2.6); float v=uB/(1.+pow(r/.68,6.)); gl_FragColor=vec4(pal(v),smoothstep(.02,.1,v)*.8); }' });
const bMaps = [T/2+0.3*GAP, -T/2-0.3*GAP].map(z=>{ const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6,2.6), bMat);
  m.position.set(XP,0,z); m.renderOrder = 3; scene.add(m); return m; });

/* ---- AC feed cables + junction boxes ---- */
function addCable(points){
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 90, 0.075, 8), matRubber);
  m.castShadow = true; scene.add(m);
}

CONFIG.cables.forEach(c => addCable(c.map(p => V3(...p))));
const feedLeds = [];
function addFeedBox(x, label){
  const m = matCast.clone();
  const box = tag(new THREE.Mesh(rbox(0.95, 0.55, 1.05, 0.05), m), 'feed');
  box.position.set(x, -4.77, 3.3); box.castShadow = box.receiveShadow = true;
  scene.add(box);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.30),
    new THREE.MeshBasicMaterial({ map:plateTexture(label) }));
  plate.position.set(x, -4.77, 3.835); scene.add(plate);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10),
    new THREE.MeshStandardMaterial({ color:0x30241a, emissive:0xffb454, emissiveIntensity:0.15 }));
  led.position.set(x, -4.43, 3.72); scene.add(led);
  feedLeds.push(led.material);
}

CONFIG.feedBoxX.forEach((x,i) => addFeedBox(x, 'ALIM. ' + 'AB'[i]));

/* ============================================================ annotations */
const ANNS = [
  [-2.3,  1.3,  T/2, -1, 'DISCO CONDUTOR', `Cu · ${DISC_TXT}`],
  [ XP,  K.coilRo - 0.05, Y_CMID-DY, -1, 'BOBINA A (FRONTAL)',  `${CONFIG.phys.turns0} esp. · ${IA} A · CA · ∥ ao disco`],
  [ XP, -(K.coilRo - 0.05), -(Y_CMID-DY), 1, 'BOBINA B (TRASEIRA)', 'em série · aditiva'],
  [ XP + X_COL, 0.5, 0.9,   1, 'NÚCLEO EM C',         'aço-Si laminado · circuito fechado'],
  [ 2.2, -0.72, T/2+0.02, -1, 'CAMPO E NO DISCO',    'circula em torno de B · Faraday'],
  [ 2.6,  0.0,  0.0,  -1, 'CAMPO B ⟂ AO DISCO',  'atravessa bobinas, entreferros e disco'],
  [ 0.15, 0.35, -4.3,  1, 'EIXO DE ACIONAMENTO', `Ø${mmOf(0.68)} · 2 mancais com rolamento`],
  [ 0.0,  1.6,  ZM,   -1, 'MOTOR',               'aciona o eixo · acoplamento flexível'],
  [ 0.0,  0.95, -3.6,  1, 'MANCAL COM ROLAMENTO', 'suporte trapezoidal · esferas'],
  [ XP,  -3.0,  -(Y_CMID-DY), 1, 'SUPORTE DAS BOBINAS', 'perfil em T · fixado na base'],
  [ 2.6, -4.40, 3.30,  1, 'ALIMENTAÇÃO CA',      '2 fios blindados'],
];
const annEls = [];
const annsLayer = document.getElementById('anns');
const leaders = document.getElementById('leaders');
const SVGNS = 'http://www.w3.org/2000/svg';
for (const [x,y,z,side,name,sub] of ANNS){
  const el = document.createElement('div'); el.className = 'ann';
  el.innerHTML = `<div class="n">${name}</div><div class="s">${sub}</div>`;
  annsLayer.appendChild(el);
  const line = document.createElementNS(SVGNS,'line');
  line.setAttribute('stroke','#8e939a'); line.setAttribute('stroke-opacity','0.5'); line.setAttribute('stroke-width','1');
  const dot = document.createElementNS(SVGNS,'circle');
  dot.setAttribute('r','2.4'); dot.setAttribute('fill','#e8a15c');
  leaders.appendChild(line); leaders.appendChild(dot);
  annEls.push({ p:new THREE.Vector3(x,y,z), side, el, line, dot });
}
function sizeSvg(){
  leaders.setAttribute('width', innerWidth); leaders.setAttribute('height', innerHeight);
  leaders.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
}
sizeSvg();

/* ============================================================ UI wiring */
const $ = id => document.getElementById(id);
const inRpm=$('inRpm'), inExc=$('inExc'), inFrq=$('inFrq');
const oRpm=$('oRpm'), oExc=$('oExc'), oFrq=$('oFrq');
function paintRange(el, txt){
  el.setAttribute('aria-valuemin', el.min); el.setAttribute('aria-valuemax', el.max);
  el.setAttribute('aria-valuenow', el.value); if (txt) el.setAttribute('aria-valuetext', txt);
  const p = (el.value-el.min)/(el.max-el.min)*100;
  el.style.background = `linear-gradient(90deg, var(--amber) ${p}%, #2a2f35 ${p}%)`;
}
function bindRange(el, out, fmt, setv){
  const upd = ()=>{ const tx = fmt(+el.value); out.textContent = tx; paintRange(el, tx); };
  el.addEventListener('input', ()=>{ setv(+el.value); upd(); });
  upd();
}
bindRange(inRpm, oRpm, v=>`${v} rpm`,        v=>params.rpm = v);
bindRange(inExc, oExc, v=>`${(v*IA).toFixed(1)} A ef.`, v=>params.exc = v);
const inTrn = $('inTrn'), oTrn = $('oTrn');
bindRange(inTrn, oTrn, v=>`${v} esp.`, v=>params.turns = v);
bindRange(inFrq, oFrq, v=>`${v.toFixed(1)} Hz`,    v=>params.freq = v);

const btnBrake = $('btnBrake');
const brakeOn  = on =>{ params.hold = on; btnBrake.classList.toggle('on', on); btnBrake.setAttribute('aria-pressed', on); };
let holdKey = false, holdPtr = false;
const syncBrake = ()=> brakeOn(holdKey || holdPtr);
const releaseBrake = ()=>{ holdKey = holdPtr = false; syncBrake(); };
btnBrake.addEventListener('pointerdown', e=>{ e.preventDefault(); holdPtr = true; syncBrake(); });
addEventListener('pointerup',     ()=>{ holdPtr = false; syncBrake(); });
addEventListener('pointercancel', ()=>{ holdPtr = false; syncBrake(); });
btnBrake.addEventListener('pointerleave', ()=>{ holdPtr = false; syncBrake(); });
addEventListener('blur', releaseBrake);
document.addEventListener('visibilitychange', ()=>{ if (document.hidden) releaseBrake(); });
// Espaço não deve roubar o atalho de controles focados (checkbox, slider, botão), exceto o próprio botão do freio
const spaceIgnored = t => t !== btnBrake && t.closest && t.closest('input,select,textarea,button,[contenteditable]');
addEventListener('keydown', e=>{ if (e.code==='Space' && !spaceIgnored(e.target)){ e.preventDefault(); if(!e.repeat){ holdKey = true; syncBrake(); } } });
addEventListener('keyup',   e=>{ if (e.code==='Space' && holdKey){ holdKey = false; syncBrake(); } });

 $('tField').onchange  = e => view.field  = e.target.checked;
 $('tSwirl').onchange  = e => view.swirl  = e.target.checked;
 $('tEfld').onchange   = e => view.efield = e.target.checked;
 $('tLabels').onchange = e =>{ view.labels = e.target.checked;
  annsLayer.style.display = leaders.style.display = e.target.checked ? '' : 'none'; };

$('tMotor').onchange = e => params.motor = e.target.checked;
$('tHeat').onchange = e =>{ const on = e.target.checked; uHM.value = on ? 1 : 0;
  for (const m of heatMats){ m.blending = on ? THREE.NormalBlending : THREE.AdditiveBlending; m.needsUpdate = true; }
  $('lgH').style.display = on ? '' : 'none'; };
$('tBmap').onchange = e =>{ bMaps.forEach(m => m.visible = e.target.checked); $('lgB').style.display = e.target.checked ? '' : 'none'; };
$('tHeat').onchange({ target:$('tHeat') }); $('tBmap').onchange({ target:$('tBmap') });
const SHQ = ['high','low','off'], SHL = { high:'ALTA', low:'BAIXA', off:'DESLIGADAS' };
let shQ = isSmall ? 'low' : 'high';
const applyShadow = q =>{ shQ = q; setShadowQuality(q); $('btnShadow').textContent = 'SOMBRAS: ' + SHL[q]; };
$('btnShadow').onclick = ()=>applyShadow(SHQ[(SHQ.indexOf(shQ)+1)%3]);
applyShadow(shQ);
$('tBloom').onchange = e => fx.bloom = e.target.checked;
$('tBloom').checked = fx.bloom = !isSmall;
const pBody = $('pBody'), btnCol = $('btnCol');
const mqSmall = matchMedia('(max-width:760px)');
const setCol = hid =>{ pBody.classList.toggle('hidden', hid); btnCol.textContent = hid ? '+' : '–';
  btnCol.setAttribute('aria-expanded', String(!hid)); };
btnCol.onclick = e =>{ e.stopPropagation(); setCol(!pBody.classList.contains('hidden')); };
$('pHead').onclick = ()=>{ if (mqSmall.matches) setCol(!pBody.classList.contains('hidden')); };  // bottom-sheet: toque no cabeçalho
setCol(mqSmall.matches);

$('btnResetTemp').onclick = () => resetTemp();   // do projeto bobina nucleada

const tbar = $('tbar'), segs = [];
for (let i=0;i<16;i++){ const d = document.createElement('div'); d.className='seg'; tbar.appendChild(d); segs.push(d); }

const rRpm=$('rRpm'), rTq=$('rTq'), rPw=$('rPw'), rI=$('rI'), rTmp=$('rTmp'), rTrk=$('rTrk'), rB=$('rB'), rDel=$('rDel'), rFax=$('rFax'), rJ=$('rJ'), rTc=$('rTc');
const stDot=$('stDot'), stTxt=$('stTxt'), hRpm=$('hRpm'), hB=$('hB');   // cabeçalho: rpm e B pico ao lado do status

/* scope */
const scope = $('scope'), sctx = scope.getContext('2d');
let SW=0, SH=0;
function sizeScope(){
  const r = scope.getBoundingClientRect();
  SW = Math.max(10, r.width); SH = Math.max(10, r.height);
  const d = Math.min(2, devicePixelRatio||1);
  scope.width = SW*d; scope.height = SH*d;
  sctx.setTransform(d,0,0,d,0,0);
}
sizeScope();
const scopeBuf = []; let tbScale = 20*CONFIG.phys.scale;

/* ============================================================ hover / tooltip */
const tip = $('tip'), tipN = tip.querySelector('.t-n'), tipS = tip.querySelector('.t-s');
const raycaster = new THREE.Raycaster(), mouse = new THREE.Vector2();
let hoverPart = null, tipXY = [0,0];
function setHL(part){
  if (hoverPart === part) return;
  for (const m of pickables){
    if (m.userData.part === hoverPart && m.userData.e0 !== undefined && m.material.emissive)
      m.material.emissive.setHex(m.userData.e0);
  }
  hoverPart = part;
  if (part && part !== 'disc' && !part.startsWith('coil')){
    for (const m of pickables) if (m.userData.part === part && m.material.emissive){
      if (m.userData.e0 === undefined) m.userData.e0 = m.material.emissive.getHex();
      m.material.emissive.setHex(0x4a2a10);
    }
  }
}
renderer.domElement.addEventListener('pointermove', e=>{
  tipXY = [e.clientX, e.clientY];
  mouse.x = (e.clientX/innerWidth)*2-1; mouse.y = -(e.clientY/innerHeight)*2+1;
  raycaster.setFromCamera(mouse, camera);
  const hit = raycaster.intersectObjects(pickables, false)[0];
  if (hit){
    const [n, s] = PARTS[hit.object.userData.part] || ['—',''];
    setHL(hit.object.userData.part);
    tipN.textContent = n; tipS.textContent = s;
    tip.style.display = 'block';
    tip.style.left = Math.min(innerWidth-250, e.clientX+16)+'px';
    tip.style.top  = Math.min(innerHeight-70,  e.clientY+12)+'px';
  } else { setHL(null); tip.style.display = 'none'; }
});
renderer.domElement.addEventListener('pointerleave', ()=>{ setHL(null); tip.style.display='none'; });

/* ============================================================ per-frame visuals */
function poleUpdate(spr, isN, aI, dt){
  const L = isN ? 'N' : 'S';
  if (spr.userData.L !== L){
    spr.userData.L = L; spr.material.map = isN ? texN : texS;
    spr.material.needsUpdate = true; spr.userData.pop = 1;
  }
  spr.userData.pop = Math.max(0, spr.userData.pop - dt*5);
  spr.scale.setScalar(0.52*(1 + 0.45*spr.userData.pop));
  spr.material.opacity = Math.min(1, aI*2.4)*0.95;
  spr.visible = spr.material.opacity > 0.03;
}
let turnsBuilt = 240;
let matBuilt = '';   // vazio: força a 1ª atualização de rótulos e dicas com o nome do material
let modeBuilt = 'ac';
let circBuilt = '';   // vazio: força a 1ª montagem (com ou sem culatra)
const ANN_CORE = 3;   // índice da anotação do núcleo em ANNS

function updateDynamics(dt){
  // intensidade visual ∝ B real: N·I efetivo após saturação × (B por A deste circuito/material ÷ núcleo em C com Cu)
  const nR = turnsRatio()*sim.sat*matProps().bInst/matProps('Cu', 'C').bInst;
  if (circBuilt !== params.circ){
    circBuilt = params.circ; const open = circBuilt === 'open';
    for (const u of units) u.setCirc(open);
    coreCol.visible = !open;
    const a = annEls[ANN_CORE];
    a.el.querySelector('.n').textContent = open ? 'NÚCLEOS POLARES' : 'NÚCLEO EM C';
    a.el.querySelector('.s').textContent = open ? 'sem culatra · fluxo volta pelo ar' : 'aço-Si laminado · circuito fechado';
    a.p.set(open ? XP + 0.3 : XP + X_COL, open ? 0.42 : 0.5, open ? Y_ARM0 + 0.07 - DY : 0.9);
    setSpecCore(open);
  }
  
  // Verifica se houve mudança nas espiras, material ou modo (CA/CC)
  if (turnsBuilt !== params.turns || matBuilt !== params.mat || modeBuilt !== params.mode){
    turnsBuilt = params.turns;
    matBuilt = params.mat;
    modeBuilt = params.mode; 
    
    // Reconstrói as espiras 3D
    for (const u of units) u.setTurns(turnsBuilt);
    
    const modeStr = modeBuilt.toUpperCase();

    // 1. Atualiza as dicas (tooltips - PARTS) ao passar o mouse
    PARTS.disc[1]  = `${CONFIG.materials[matBuilt].name} · ${DISC_TXT} · correntes de Foucault → calor`;
    PARTS.coilA[1] = `${turnsBuilt} espiras Cu · ${IA} A ef. nominal · ${modeStr} · ∥ ao disco`;
    PARTS.coilB[1] = `${turnsBuilt} espiras Cu · em série (aditiva) · ∥ ao disco`;

    // 2. Atualiza as anotações textuais flutuantes na tela (annEls)
    if (annEls.length > 2) {
      // annEls[0] é a anotação do DISCO CONDUTOR
      annEls[0].el.querySelector('.s').textContent = `${CONFIG.materials[matBuilt].name} · ${DISC_TXT}`;
      // annEls[1] é a anotação da BOBINA A
      annEls[1].el.querySelector('.s').textContent = `${turnsBuilt} esp. · Cu · ${modeStr} · ∥ ao disco`;
    }
  }
  const IPK = 1.4*IA, aI  = Math.min(1, Math.abs(sim.I)/IPK), aB = Math.min(1, Math.abs(sim.I)*nR/IPK);   // aI: corrente; aB: campo (∝ N·I); IPK ≈ pico nominal
  const sgn = sim.I >= 0 ? 1 : -1;
  const eN  = Math.min(1, Math.abs(sim.omega)*sim.uEff*sim.uEff*nR*nR/25);   // /25: normalização visual (Ir² nominal ≈ 0,36 com o núcleo saturando)
  sim.eN = eN;
  const dI = (sim.uEff > 0 && params.mode === 'ac') ? Math.cos(sim.theta) : 0;
  for (const u of units){
    const fT = (sim.I*u.sign > 0) ? 1 : 0;
    u.mix += (fT - u.mix)*Math.min(1, dt*14);
    u.fieldMat.color.copy(C_CYAN).lerp(C_AMBER, u.mix).multiplyScalar(fx.bloom ? CONFIG.bloom.fieldGain : 1);
    u.fieldMat.opacity = (view.field ? 1 : 0)*aB*0.9;
    u.fieldMesh.visible = view.field && u.fieldMat.opacity > 0.02;
    u.fieldTex.offset.x += u.sign*sgn*(0.25 + 0.85*aB)*dt;
    u.coilOvMat.opacity = (view.efield ? 1 : 0)*0.9*aI;
    u.eMat.opacity = (view.efield ? 1 : 0)*Math.min(1, Math.abs(dI)*sim.uEff*nR)*0.9;
    u.eMesh.visible = u.eMat.opacity > 0.02;
    u.eTex.offset.x += Math.sign(dI)*(0.3 + 0.5*Math.abs(dI))*dt;
    u.coilOvMesh.visible = u.coilOvMat.opacity > 0.02;
    u.coilOvTex.offset.x -= sgn*(0.4 + 1.4*aI)*dt;
    const hb = (hoverPart === 'coilA' || hoverPart === 'coilB') ? 0.16 : 0;
    u.coilMat.emissive.setRGB(1.0, 0.55, 0.28).multiplyScalar(0.05 + 0.28*aI + hb);
    u.swirlMat.opacity = (view.swirl ? 1 : 0)*eN*0.9;
    const spin = sgn*u.sign*(sim.omega < 0 ? -1 : 1)*(2.2 + 10*eN);   // Lenz: J ∝ v×B
    for (const a of u.swirls) a.rotation.z += spin*a.userData.dir*dt;
    for (const a of u.swirls) a.visible = view.swirl && eN > 0.02;
    poleUpdate(u.sprF, sim.I*u.sign >= 0, aB, dt);
    poleUpdate(u.sprB, sim.I*u.sign <  0, aB, dt);
  }
  for (const m of feedLeds) m.emissiveIntensity = 0.15 + 2.6*Math.min(1, sim.uEff);
  motorLed.emissiveIntensity = params.motor ? 2.2 : 0.1;
  uB.value = Math.min(1, Math.abs(bOf(sim.I))/0.8);   // fim da escala do mapa: 0,8 T
  uBase.value = 0.4*Math.max(0, Math.min(1, (sim.temp-28)/272));
  uHeat.phi.value = sim.phi % (2*Math.PI); uHeat.om.value = sim.omega; uHeat.eN.value = sim.eN; uHeat.temp.value = sim.temp; uHeat.trk.value = Math.max(0, sim.tTrack - sim.temp);
  const heat = Math.max(0, Math.min(1, (sim.temp-60)/280))*(fx.bloom ? CONFIG.bloom.discGain : 1);
  const hbD = hoverPart === 'disc' ? 0.22 : 0;
  discMat.emissive.setRGB(0.55*heat + hbD, 0.16*heat + 0.09*hbD, 0.05*heat);
}

/* ---- scope ---- */
function drawScope(){
  sctx.clearRect(0,0,SW,SH);
  sctx.strokeStyle = 'rgba(255,255,255,0.05)'; sctx.lineWidth = 1;
  for (let k=0;k<=5;k++){ const x = Math.round((k/5)*SW)+0.5;
    sctx.beginPath(); sctx.moveTo(x,0); sctx.lineTo(x,SH); sctx.stroke(); }
  sctx.strokeStyle = 'rgba(255,255,255,0.10)';
  sctx.beginPath(); sctx.moveTo(0,SH/2); sctx.lineTo(SW,SH/2); sctx.stroke();
  if (scopeBuf.length < 2) return;
  const t0 = sim.t - 5;
  const trace = (fy, color, lw)=>{
    sctx.strokeStyle = color; sctx.lineWidth = lw; sctx.beginPath();
    let first = true;
    for (const p of scopeBuf){
      const x = (p.t-t0)/5*SW, y = fy(p);
      if (first){ sctx.moveTo(x,y); first=false; } else sctx.lineTo(x,y);
    }
    sctx.stroke();
  };
  const iS = Math.max(1.5*IA, sim.Irms*1.6);
  trace(p => SH/2 - (Math.max(-iS,Math.min(iS,p.i))/iS)*(SH/2-4), 'rgba(255,180,84,0.92)', 1.4);
  let tbMax = 0; for (const p of scopeBuf) if (p.tb > tbMax) tbMax = p.tb;
  tbScale += (Math.max(5*CONFIG.phys.scale, tbMax*1.1) - tbScale)*0.08;       // autoescala suavizada
  trace(p => SH-3 - Math.min(1, p.tb/tbScale)*(SH-10), 'rgba(154,162,171,0.85)', 1.2);
}

/* ---- curva T×ω (Wouterse; do projeto bobina nucleada): T = 2·Tmáx·s/(1+s²), s = ω/ωc(ω), com o ponto de operação ---- */
const curve = $('curve'), cctx = curve.getContext('2d'), curveInfo = $('curveInfo');
let CW = 0, CH = 0, cYmax = 0.3;
function sizeCurve(){
  const r = curve.getBoundingClientRect(), d = Math.min(2, devicePixelRatio||1);
  CW = Math.max(10, r.width); CH = Math.max(10, r.height);
  curve.width = CW*d; curve.height = CH*d; cctx.setTransform(d,0,0,d,0,0);
}
sizeCurve();
const NCV = 80, cvT = new Float64Array(NCV + 1);
function drawCurve(){
  const { wc, tmax, th, Bq, bn } = curveNow(), wa = Math.abs(sim.omega), ferro = !!matProps().ferro;
  const wMax = Math.max(Math.min(2.5*wc, 2*2400*Math.PI/30), 1.1*wa, 1.1*params.rpm*Math.PI/30, 5);   // mostra o pico, sem passar de 2× a escala do motor
  let top = 0; for (let n = 0; n <= NCV; n++){ cvT[n] = torqueAt(wMax*n/NCV, Bq, bn); if (cvT[n] > top) top = cvT[n]; }
  cYmax += (Math.max(top, 1e-3)*1.15 - cYmax)*0.15;
  const X = w => 6 + w/wMax*(CW-12), Y = t => CH-14 - Math.min(1, t/cYmax)*(CH-24);
  cctx.clearRect(0,0,CW,CH); cctx.lineWidth = 1;
  cctx.strokeStyle = 'rgba(255,255,255,0.10)'; cctx.beginPath(); cctx.moveTo(0,CH-14.5); cctx.lineTo(CW,CH-14.5); cctx.stroke();
  if (wc < wMax){ cctx.setLineDash([3,3]); cctx.strokeStyle = 'rgba(99,199,214,0.7)';
    cctx.beginPath(); cctx.moveTo(X(wc),4); cctx.lineTo(X(wc),CH-14); cctx.stroke(); cctx.setLineDash([]);
    cctx.fillStyle = 'rgba(99,199,214,0.95)'; cctx.font = '9px monospace'; cctx.fillText('ωc', Math.min(CW-18, X(wc)+3), 11); }
  cctx.strokeStyle = 'rgba(255,180,84,0.92)'; cctx.lineWidth = 1.4; cctx.beginPath();
  for (let n = 0; n <= NCV; n++){ const x = X(wMax*n/NCV), y = Y(cvT[n]); n ? cctx.lineTo(x,y) : cctx.moveTo(x,y); }
  cctx.stroke();
  cctx.fillStyle = '#fff'; cctx.beginPath(); cctx.arc(X(wa), Y(Math.abs(sim.TbM) + (wa > 0 ? sim.ThM : 0)), 3.2, 0, 7); cctx.fill();
  cctx.fillStyle = '#8e939a'; cctx.font = '9px monospace';
  cctx.fillText('0', 6, CH-3); cctx.fillText(Math.round(wMax*9.5493) + ' rpm', CW-48, CH-3);
  const reg = wa < wc ? (ferro ? 'resistivo (δ < d: sublinear)' : 'resistivo: T ∝ ω') : (ferro ? 'indutivo: T ∝ 1/√ω (pelicular)' : 'indutivo: T ∝ 1/ω');
  const w0 = params.rpm*Math.PI/30, ts = w0 > 1 && Bq > 1e-6 ? stopTime(w0, w0/10, Bq, bn) : NaN;   // t = J·∫dω/T(ω), motor desligado
  setT(curveInfo, `ωc ${Math.round(wc*9.5493)} rpm · Tmáx ${tmax.toFixed(2)} N·m · ${reg}` + (ferro ? ` · histerese ${(th*1e3).toFixed(1)} mN·m` : '')
    + (Number.isFinite(ts) ? ` · parada ${params.rpm}→${Math.round(params.rpm/10)} rpm ${ts.toFixed(2)} s` : ''));
}

/* ---- HUD ---- */
const setT = (el, v)=>{ if (el._t !== v){ el._t = v; el.textContent = v; } };   // só toca o DOM se mudou
const setC = (el, v)=>{ if (el._c !== v){ el._c = v; el.className = v; } };
function updateHUD(){
  setT(rRpm, (sim.omega < -0.2 ? '−' : '') + String(Math.round(Math.abs(sim.omega)*9.5493)).padStart(4,'0'));
  setT(rTq, (Math.abs(sim.TbM) + (sim.omega !== 0 ? sim.ThM : 0)).toFixed(2));   // Foucault + histerese (disco ferromagnético), média no ciclo
  setT(rPw, Math.round(sim.PM).toString());
  setT(rI, sim.Iact.toFixed(1)); setC(rI, Math.abs(sim.Vapp) >= 0.999*COILP.vBus ? 'hot' : '');   // vermelho: fonte no limite de tensão (não alcança a referência)
  setT(rJ, sim.Jcu.toFixed(1)); setC(rJ, sim.Jcu > 6 ? 'hot' : '');                 // > 6 A/mm²: só intermitente
  setT(rTc, String(Math.round(sim.tCoil))); setC(rTc, sim.tCoil > 155 ? 'hot' : '');  // isolação classe F
  { const b = peakB().toFixed(2), hot = sim.sat < 0.76 ? 'hot' : '';   // B_lin > Bsat: núcleo saturando
    setT(rB, b); setC(rB, hot); setT(hB, b); setC(hB, hot); }
  setT(hRpm, (sim.omega < -0.2 ? '−' : '') + Math.round(Math.abs(sim.omega)*9.5493));
  setT(rTmp, String(Math.round(sim.temp)));
  setC(rTmp, sim.temp > 180 ? 'hot' : '');
  setT(rTrk, String(Math.round(sim.tTrack))); setC(rTrk, sim.tTrack > 250 ? 'hot' : '');
  setT(rDel, Number.isFinite(sim.delta) && sim.delta < 1 ? (sim.delta*1e3).toFixed(sim.delta < 1e-3 ? 2 : 1) : '∞');
  setT(rFax, String(Math.round(sim.Fax)));
  const n = Math.round(Math.max(0, Math.min(1, (sim.tTrack-28)/312))*16);
  segs.forEach((el,i)=> setC(el, 'seg' + (i<n ? ' lit' : '') + (i<n && i>=12 ? ' r' : '')));
  let st = 'PRONTO', cls = '';
  if (sim.Irms > 0.3 && Math.abs(sim.omega) < 2){ st = 'EIXO PARADO'; cls = 'on'; }
  else if (sim.Irms > 0.3 && Math.abs(sim.TbM) > 3*CONFIG.phys.scale){ st = 'FRENANDO'; cls = 'on'; }
  else if (Math.abs(sim.omega) > 2){ st = 'EM ROTAÇÃO'; cls = 'run'; }
  setT(stTxt, st); setC(stDot, 'dot ' + cls);
}

/* ---- annotations projection ---- */
const pv = new THREE.Vector3();
function updateAnnotations(){
  if (!view.labels) return;
  for (const a of annEls){
    pv.copy(a.p).project(camera);
    const vis = pv.z < 1;
    a.el.style.display = a.line.style.display = vis ? '' : 'none';
    if (!vis){ a.dot.style.display = 'none'; continue; }
    a.dot.style.display = '';
    const x = (pv.x+1)/2*innerWidth, y = (1-pv.y)/2*innerHeight;
    const lx = x + a.side*56, ly = y - 40;
    a.el.style.transform = `translate(${lx}px,${ly}px)` + (a.side<0 ? ' translateX(-100%)' : '');
    a.line.setAttribute('x1', x);  a.line.setAttribute('y1', y);
    a.line.setAttribute('x2', lx); a.line.setAttribute('y2', ly+4);
    a.dot.setAttribute('cx', x);  a.dot.setAttribute('cy', y);
  }
}

/* ============================================================ main loop */
let acc = 0, last = performance.now()/1000, hudAcc = 1, heatAcc = 1, introT = 0, introDone = false;
function cancelIntro(){
  if (introDone) return;
  introDone = true; controls.enabled = true; controls.autoRotate = true;
}
renderer.domElement.addEventListener('pointerdown', cancelIntro);

function frame(){
  requestAnimationFrame(frame);
  const now = performance.now()/1000;
  const raw = Math.max(0, now-last); last = now;
  const dt = Math.min(0.05, raw);

  if (!introDone){
    introT += dt/2.4;
    const e = 1 - Math.pow(1-Math.min(1,introT), 3);
    camera.position.lerpVectors(camFrom, camTo, e);
    camera.lookAt(controls.target);
    if (introT >= 1){ introDone = true; controls.enabled = true; controls.autoRotate = true; }
  }

  // passo fixo com acumulador: física determinística, independente do FPS
  acc += Math.min(raw, CONFIG.sim.maxFrame);
  let n = 0;
  while (acc >= CONFIG.sim.dt && n < CONFIG.sim.maxSteps){
    step(CONFIG.sim.dt); acc -= CONFIG.sim.dt; n++;
    if (scopeBuf.length && scopeBuf[scopeBuf.length-1].t > sim.t) scopeBuf.length = 0;   // reset → limpa o traço
    record();
    scopeBuf.push({ t:sim.t, i:sim.I, tb:Math.abs(sim.Tb) });   // torque instantâneo da dinâmica ∝ B(t)²: média = TbM (pico < 2·TbM quando o núcleo satura)
  }
  if (n === CONFIG.sim.maxSteps) acc = 0;
  discGroup.rotation.z = sim.phi;
  shaftGroup.rotation.z = sim.phi;
  for (const c of cages) c.rotation.z = 0.4*sim.phi;   // gaiola do rolamento ≈ 0,4·ω

  updateDynamics(dt);
  updateAudio(); updateCamera(dt);

  while (scopeBuf.length && scopeBuf[0].t < sim.t-5.3) scopeBuf.shift();
  drawScope(); drawCurve();

  hudAcc += dt; if (hudAcc > CONFIG.hudEvery){ hudAcc = 0; updateHUD(); }

  updateAnnotations();
  controls.update();
  render();
}

addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  resizeGL();
  sizeSvg(); sizeScope(); sizeCurve();
});

initFeatures();
frame();
