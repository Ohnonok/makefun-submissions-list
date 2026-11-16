// Three.js scene for KILNWORKS. One job: turn sim state into pixels.
// No allocations in the hot loop: meshes, materials and geometries are built once
// in buildScene(); per frame we only move existing objects and toggle visibility.
// Palette: dusk brickworks — ember amber against cold blue night, teal crew vs
// amber gang, so the two teams read at a glance.
import * as THREE from 'three';
import { MAP } from './map.js';

const PALETTE = {
  ground: 0x2b241c, ground2: 0x33291e, wall: 0x4a3226, wallTop: 0x5d4030,
  kiln: 0x6b3a28, kilnDark: 0x3d2118, crate: 0x6e5636, crate2: 0x7d6240,
  furnace: 0x4a423c, metal: 0x3a3f45, chimney: 0x4c2f22,
  ct: 0x7fc4b2, t: 0xe8a33d, ctDark: 0x2c5a4e, tDark: 0x6e4413,
  lamp: 0xffc46b, fog: 0x241c14, sky: 0x2a2118,
};

export class Renderer {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.sky);
    this.scene.fog = new THREE.Fog(PALETTE.fog, 40, 120);
    this.camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.08, 160);
    this.actorMeshes = new Map();
    this.tracerPool = [];
    this.smokeMeshes = [];
    this.flashMesh = null;
    this.bombMesh = null;
    this.weaponMesh = null;
    this.weaponGroup = new THREE.Group();
    this.camera.add(this.weaponGroup);
    this.scene.add(this.camera);
    this._buildLights();
    this._buildMap();
    this._buildWeapon();
    window.addEventListener('resize', () => this.resize());
  }
  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
  _mat(color, rough = 0.9, metal = 0.05) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  }
  _buildLights() {
    const amb = new THREE.AmbientLight(0x8a7a66, 0.95);
    this.scene.add(amb);
    const hemi = new THREE.HemisphereLight(0x8a97b8, 0x2a2018, 0.55);
    this.scene.add(hemi);
    const moon = new THREE.DirectionalLight(0x9db8e8, 0.9);
    moon.position.set(-30, 42, -18);
    // No shadow map: one hard directional shadow edge read as a giant dark
    // slope across the yard in screenshots, so the scene stays evenly lit.
    this.scene.add(moon);
    this.lamps = [];
    for (const d of MAP.dressing.filter((x) => x.kind === 'lamp')) {
      const p = new THREE.PointLight(PALETTE.lamp, 30, 30, 1.8);
      p.position.set(d.x, 5.2, d.z);
      this.scene.add(p);
      this.lamps.push(p);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffd88a }));
      bulb.position.set(d.x, 5.2, d.z);
      this.scene.add(bulb);
    }
    const furnaceGlow = new THREE.PointLight(0xff5a1f, 30, 20, 1.6);
    furnaceGlow.position.set(0, 3, -6);
    this.scene.add(furnaceGlow);
    this.furnaceGlow = furnaceGlow;
  }
  _box(x0, z0, x1, z1, h, mat, y0 = 0) {
    const w = x1 - x0, d = z1 - z0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set((x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2);
    m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }
  _buildMap() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), this._mat(PALETTE.ground, 1));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    // Checker of darker slabs so the ground reads as paved yard, not void.
    const slabMat = this._mat(PALETTE.ground2, 1);
    for (let gx = -34; gx < 36; gx += 8) {
      for (let gz = -26; gz < 28; gz += 8) {
        if (((gx + gz) / 8) % 2 === 0) {
          const s = new THREE.Mesh(new THREE.PlaneGeometry(7.8, 7.8), slabMat);
          s.rotation.x = -Math.PI / 2; s.position.set(gx + 4, 0.01, gz + 4);
          s.receiveShadow = true;
          this.scene.add(s);
        }
      }
    }
    const wallMat = this._mat(PALETTE.wall, 0.95);
    const wallTopMat = this._mat(PALETTE.wallTop, 0.9);
    const kilnMat = this._mat(PALETTE.kiln, 0.85);
    const kilnDark = this._mat(PALETTE.kilnDark, 0.9);
    const crateMat = this._mat(PALETTE.crate, 0.9);
    const crateMat2 = this._mat(PALETTE.crate2, 0.9);
    const metalMat = this._mat(PALETTE.metal, 0.6, 0.05);
    // The furnace block gets its own matte brick: a metal material renders
    // its north face pure black (no environment map), which read as a void.
    const furnaceMat = this._mat(0x6b4a34, 0.85, 0.05);
    for (const c of MAP.colliders) {
      const isWall = c.h >= 6;
      const isKiln = c.x0 <= -14 && c.z0 <= -4 && c.h >= 3;
      const isFurnace = c.x0 === -4 && c.z0 === -4;
      const mat = isWall ? wallMat : isKiln ? kilnMat : isFurnace ? furnaceMat : c.h > 3 ? metalMat : (c.x1 - c.x0 + c.z1 - c.z0) % 2 < 1 ? crateMat : crateMat2;
      this._box(c.x0, c.z0, c.x1, c.z1, c.h, mat);
      if (isWall) this._box(c.x0, c.z0, c.x1, c.z1, 0.25, wallTopMat, c.h);
      if (isKiln) {
        // Kiln mouth: a dark glowing arch on the kiln face.
        const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.9, 16), new THREE.MeshBasicMaterial({ color: 0xff6a22 }));
        mouth.position.set((c.x0 + c.x1) / 2, 1.4, c.z1 + 0.02);
        this.scene.add(mouth);
      }
    }
    // Chimneys.
    for (const d of MAP.dressing.filter((x) => x.kind === 'chimney')) {
      const ch = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, 14, 10), this._mat(PALETTE.chimney, 0.95));
      ch.position.set(d.x, 7, d.z); ch.castShadow = true;
      this.scene.add(ch);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.5, 10), kilnDark);
      cap.position.set(d.x, 14.2, d.z);
      this.scene.add(cap);
    }
    // Drying racks: thin frames with brick-coloured slats.
    for (const d of MAP.dressing.filter((x) => x.kind === 'rack')) {
      const rack = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 0.1), metalMat);
      frame.position.y = 2.2;
      rack.add(frame);
      for (let i = 0; i < 5; i++) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.8, 0.08), i % 2 ? kilnMat : kilnDark);
        slat.position.set(-1.6 + i * 0.8, 1.1, 0);
        rack.add(slat);
      }
      rack.position.set(d.x, 0, d.z);
      this.scene.add(rack);
    }
    // Site markers: glowing floor rings + floating letters.
    this.siteRings = {};
    for (const [key, site] of Object.entries(MAP.sites)) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(site.r - 0.35, site.r, 40),
        new THREE.MeshBasicMaterial({ color: key === 'A' ? 0xe8a33d : 0x7fc4b2, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(site.x, 0.03, site.z);
      this.scene.add(ring);
      this.siteRings[key] = ring;
      const label = this._makeTextSprite(key === 'A' ? 'A — KILN HALL' : 'B — BRICK YARD', key === 'A' ? '#e8a33d' : '#7fc4b2');
      label.position.set(site.x, 4.6, site.z);
      this.scene.add(label);
    }
    // Bomb mesh (hidden until planted) + a red pulse light so the planted
    // charge reads at a glance from across the site.
    this.bombMesh = new THREE.Group();
    const bombBody = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.36, 0.46), new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.4, metalness: 0.7 }));
    this.bombMesh.add(bombBody);
    const bombLight = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    bombLight.position.set(0.24, 0.24, 0);
    this.bombMesh.add(bombLight);
    this.bombLight = bombLight;
    this.bombGlow = new THREE.PointLight(0xff2a18, 10, 12, 1.5);
    this.bombGlow.position.set(0, 0.8, 0);
    this.bombMesh.add(this.bombGlow);
    this.bombMesh.visible = false;
    this.scene.add(this.bombMesh);
    // Smoke puffs (pooled spheres, scaled up when active).
    const smokeMat = new THREE.MeshStandardMaterial({ color: 0x9a9a94, roughness: 1, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 6; i++) {
      const sm = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), smokeMat.clone());
      sm.visible = false;
      this.scene.add(sm);
      this.smokeMeshes.push(sm);
    }
  }
  _makeTextSprite(text, color) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(10,8,6,0.55)';
    g.fillRect(0, 0, 512, 96);
    g.font = 'bold 44px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(text, 256, 50);
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(7, 1.3, 1);
    return sp;
  }
  _buildWeapon() {
    // A simple first-person rifle assembled from boxes — it reads as a gun
    // from the player's view and never pretends to be a commercial model.
    const dark = this._mat(0x4a4438, 0.5, 0.5);
    const wood = this._mat(0x8a5f30, 0.8);
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.62), dark);
    body.position.set(0, -0.02, -0.3);
    group.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 8), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, -0.01, -0.72);
    group.add(barrel);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.13, 0.22), wood);
    stock.position.set(0, -0.03, 0.08);
    group.add(stock);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.1), dark);
    mag.position.set(0, -0.12, -0.28);
    mag.rotation.x = 0.25;
    group.add(mag);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), dark);
    sight.position.set(0, 0.06, -0.35);
    group.add(sight);
    group.position.set(0.24, -0.22, -0.45);
    group.scale.set(0.72, 0.72, 0.72);
    this.weaponGroup.add(group);
    this.weaponMesh = group;
    this.weaponBasePos = group.position.clone();
  }
  // One pooled actor mesh per bot/player (body capsule + head + team band).
  _actorMesh(a) {
    let m = this.actorMeshes.get(a.id);
    if (m) return m;
    const teamCol = a.side === 'CT' ? PALETTE.ct : PALETTE.t;
    const darkCol = a.side === 'CT' ? PALETTE.ctDark : PALETTE.tDark;
    const group = new THREE.Group();
    const bodyMat = this._mat(teamCol, 0.85);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.85, 4, 10), bodyMat);
    body.position.y = 0.95; body.castShadow = true;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), this._mat(0xc9a37e, 0.7));
    head.position.y = 1.72; head.castShadow = true;
    group.add(head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), this._mat(darkCol, 0.6, 0.3));
    helmet.position.y = 1.74;
    group.add(helmet);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.7), this._mat(0x1d1a16, 0.5, 0.5));
    gun.position.set(0.3, 1.25, 0.35);
    group.add(gun);
    // Name tag sprite.
    const tag = this._makeTextSprite(a.name, a.side === 'CT' ? '#7fc4b2' : '#e8a33d');
    tag.scale.set(2.2, 0.42, 1);
    tag.position.y = 2.15;
    group.add(tag);
    this.scene.add(group);
    m = { group, body, head, tag, gun };
    this.actorMeshes.set(a.id, m);
    return m;
  }
  render(s, p, time, recoilKick, flashAlpha) {
    // Player camera.
    const eyeY = 1.55 - (p.crouch ? 0.35 : 0) + p.y;
    this.camera.position.set(p.x, eyeY, p.z);
    this.camera.rotation.order = 'YXZ';
    // Camera forward must match the sim's yaw convention (forward =
    // (cos yaw, -sin yaw)): three.js looks down -Z, so rotation.y = yaw - PI/2.
    this.camera.rotation.y = p.yaw - Math.PI / 2;
    this.camera.rotation.x = p.pitch + recoilKick;
    this.camera.rotation.z = 0;
    // Zoom (sniper scope): narrow the FOV while right mouse is held.
    const wantFov = p._zoom ? 32 : 78;
    if (Math.abs(this.camera.fov - wantFov) > 0.5) {
      this.camera.fov += (wantFov - this.camera.fov) * 0.2;
      this.camera.updateProjectionMatrix();
    }
    // Actors.
    for (const a of s.actors) {
      const m = this._actorMesh(a);
      m.group.visible = a.alive && !a.isPlayer;
      if (!a.alive || a.isPlayer) continue;
      m.group.position.set(a.x, 0, a.z);
      m.group.rotation.y = a.yaw + Math.PI / 2;
      // Crouch squashes the body; flash blinds show as a white head flash.
      const squash = a.crouch ? 0.78 : 1;
      m.group.scale.set(1, squash, 1);
      m.head.material.color.setHex(a.blindT > 0 ? 0xffffff : 0xc9a37e);
    }
    // Tracers (pooled lines, 24 max).
    while (this.tracerPool.length < s.tracers.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd88a, transparent: true, opacity: 0.9 }));
      line.frustumCulled = false;
      this.scene.add(line);
      this.tracerPool.push(line);
    }
    s.tracers.forEach((t, i) => {
      const line = this.tracerPool[i];
      line.visible = true;
      const pos = line.geometry.attributes.position.array;
      pos[0] = t.x0; pos[1] = t.y0; pos[2] = t.z0;
      pos[3] = t.x1; pos[4] = t.y1; pos[5] = t.z1;
      line.geometry.attributes.position.needsUpdate = true;
      line.material.opacity = Math.min(1, t.t / 0.08);
    });
    for (let i = s.tracers.length; i < this.tracerPool.length; i++) this.tracerPool[i].visible = false;
    // Smoke.
    s.smokes.forEach((sm, i) => {
      const mesh = this.smokeMeshes[i];
      if (!mesh) return;
      mesh.visible = true;
      mesh.position.set(sm.x, 1.1, sm.z);
      const grow = 1 + (12 - sm.t) * 0.12;
      mesh.scale.set(sm.r * grow, sm.r * 0.55 * grow, sm.r * grow);
      mesh.material.opacity = Math.min(0.9, sm.t / 3);
    });
    for (let i = s.smokes.length; i < this.smokeMeshes.length; i++) this.smokeMeshes[i].visible = false;
    // Bomb.
    this.bombMesh.visible = s.bombPlanted;
    if (s.bombPlanted) {
      this.bombMesh.position.set(s.bombX, 0.2, s.bombZ);
      const blink = Math.floor(time * 3) % 2 === 0;
      this.bombLight.material.color.setHex(blink ? 0xff2222 : 0x441111);
      this.bombGlow.intensity = blink ? 12 : 4;
    }
    // Site rings pulse when the bomb is planted there.
    for (const [key, ring] of Object.entries(this.siteRings)) {
      ring.material.opacity = s.bombPlanted && s.bombSite === key
        ? 0.5 + 0.4 * Math.sin(time * 6) : 0.55;
    }
    // Furnace glow flickers.
    this.furnaceGlow.intensity = 26 + Math.sin(time * 7) * 4 + Math.sin(time * 13) * 2;
    // Weapon bob + recoil.
    const bob = p.moving ? Math.sin(time * 10) * 0.012 : 0;
    this.weaponMesh.position.set(
      this.weaponBasePos.x,
      this.weaponBasePos.y + bob - recoilKick * 0.4,
      this.weaponBasePos.z + recoilKick * 0.9,
    );
    this.weaponMesh.visible = p.alive;
    this.renderer.render(this.scene, this.camera);
  }
}
