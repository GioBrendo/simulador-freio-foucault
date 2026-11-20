import * as THREE from 'three';

/* ============================================================ materials */
const matSteel = new THREE.MeshStandardMaterial({ color:0x9aa2ab, metalness:0.95, roughness:0.32 });
const matCore  = new THREE.MeshStandardMaterial({ color:0x767d86, metalness:0.85, roughness:0.5 });
const matShoe  = new THREE.MeshStandardMaterial({ color:0x8b929b, metalness:0.9,  roughness:0.4 });
const matCast  = new THREE.MeshStandardMaterial({ color:0x43484f, metalness:0.55, roughness:0.7 });
const matCopper= new THREE.MeshStandardMaterial({ color:0xc97a3f, metalness:1.0,  roughness:0.3, emissive:0x000000 });
const matCoil  = new THREE.MeshPhysicalMaterial({ color:0xb06028, metalness:0.85, roughness:0.34, clearcoat:0.5, clearcoatRoughness:0.4, emissive:0x000000 });
const matBrass = new THREE.MeshStandardMaterial({ color:0xcaa14e, metalness:1.0,  roughness:0.35 });
const matRubber= new THREE.MeshStandardMaterial({ color:0x1e2023, metalness:0.1,  roughness:0.9 });
const matPhen  = new THREE.MeshStandardMaterial({ color:0x452a20, metalness:0.1,  roughness:0.75 });
const matFloor = new THREE.MeshStandardMaterial({ color:0x131519, metalness:0,    roughness:0.95 });

/* ============================================================ canvas textures */
function stripeTexture(){
  const c = document.createElement('canvas'); c.width = 256; c.height = 8;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0,0,256,0);
  // alphaMap lê o canal G: pintar em cinza opaco (preto→branco→preto), não branco com alfa
  g.addColorStop(0,'#000'); g.addColorStop(0.30,'#000');
  g.addColorStop(0.44,'#fff'); g.addColorStop(0.58,'#000');
  g.addColorStop(1,'#000');
  x.fillStyle = g; x.fillRect(0,0,256,8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
const stripeBase = stripeTexture();

// sulcos concêntricos de usinagem (torneamento): rugosidade + relevo; o UV das tampas do cilindro é polar e centrado
function grooveTexture(){
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d'); x.fillStyle = '#b4b4b4'; x.fillRect(0,0,512,512);
  for (let i=0;i<240;i++){ const v = 110 + Math.random()*145 | 0;
    x.strokeStyle = `rgb(${v},${v},${v})`; x.lineWidth = 0.6 + Math.random()*1.4;
    x.beginPath(); x.arc(256,256, 8 + Math.random()*248, 0, Math.PI*2); x.stroke(); }
  const g = new THREE.CanvasTexture(c); g.anisotropy = 4; return g;
}
const groove = grooveTexture();
matCopper.roughnessMap = groove; matCopper.bumpMap = groove; matCopper.bumpScale = 0.6;

// flor de zinco ("spangle") do aço galvanizado por imersão a quente: grãos de Voronoi com dendritas, feito 1× sob demanda
let spangle = null;
function spangleTex(){
  if (spangle) return spangle;
  const S = 512, NC = 18, cs = S/NC, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), img = x.createImageData(S, S), seeds = [];
  for (let j = 0; j < NC; j++) for (let i = 0; i < NC; i++)
    seeds.push({ x:(i + 0.15 + 0.7*Math.random())*cs, y:(j + 0.15 + 0.7*Math.random())*cs, v:172 + Math.random()*50, a:Math.random()*Math.PI, f:0.35 + Math.random()*0.5, p:Math.random()*6.3 });
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++){
    const ci = px/cs | 0, cj = py/cs | 0; let d1 = 1e9, d2 = 1e9, b = null;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++){
      const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= NC || j >= NC) continue;
      const q = seeds[j*NC + i], d = (px - q.x)**2 + (py - q.y)**2;
      if (d < d1){ d2 = d1; d1 = d; b = q; } else if (d < d2) d2 = d;
    }
    const u = (px - b.x)*Math.cos(b.a) + (py - b.y)*Math.sin(b.a), w = -(px - b.x)*Math.sin(b.a) + (py - b.y)*Math.cos(b.a);
    let v = b.v + 8*Math.sin(u*b.f + b.p) + 5*Math.sin(w*b.f*1.7 + Math.abs(u)*0.2);   // dendritas: estrias em 2 direções por grão
    if (Math.sqrt(d2) - Math.sqrt(d1) < 1.2) v -= 20;                                    // contorno de grão
    const o = (py*S + px)*4; img.data[o] = img.data[o+1] = img.data[o+2] = Math.max(0, Math.min(255, v)); img.data[o+3] = 255;
  }
  x.putImageData(img, 0, 0);
  spangle = new THREE.CanvasTexture(c); spangle.colorSpace = THREE.SRGBColorSpace; spangle.anisotropy = 4;
  return spangle;
}

function poleTexture(letter, color){
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.strokeStyle = color; x.lineWidth = 7;
  x.beginPath(); x.arc(64,64,54,0,Math.PI*2); x.stroke();
  x.fillStyle = color; x.font = '700 64px monospace';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(letter, 64, 69);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const texN = poleTexture('N', '#ffb454'), texS = poleTexture('S', '#63c7d6');

function plateTexture(txt){
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#17191c'; x.fillRect(0,0,256,128);
  x.strokeStyle = '#39404a'; x.lineWidth = 4; x.strokeRect(8,8,240,112);
  x.fillStyle = '#e8a15c'; x.font = '600 46px monospace';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(txt, 128, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


export { matSteel, matCore, matShoe, matCast, matCopper, matCoil, matBrass, matRubber, matPhen, matFloor, stripeBase, texN, texS, plateTexture, groove, spangleTex };
