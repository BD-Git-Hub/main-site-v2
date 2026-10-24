import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

type Point = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };

type Guide = {
  anchors: Point[];
  count: number;
  spread: number;
  gain: number;
  width: number;
  focus: number;
  shear?: number;
  dimStart?: number;
  dimEnd?: number;
  quiet?: Box;
  avoid?: Box[];
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const field = document.querySelector<HTMLElement>(".light-field");
const canvas = document.querySelector<HTMLCanvasElement>("#fiber-field");

if (!reduceMotion && field && canvas) {
  startFiberField(field, canvas);
}

function startFiberField(field: HTMLElement, canvas: HTMLCanvasElement) {
  let renderer: THREE.WebGLRenderer;

  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
  } catch (error) {
    console.warn("Fiber light field could not start.", error);
    return;
  }

  const mobile = window.innerWidth < 760;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, mobile ? 1 : 1.35);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ReinhardToneMapping;
  renderer.toneMappingExposure = 1;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.z = 20;

  const uniforms = { uTime: { value: 0 } };
  const ribbonMaterial = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime;
      attribute float aAlong;
      attribute float aSide;
      attribute vec2 aNormal;
      attribute vec3 aColor;
      attribute float aSeed;
      attribute float aGain;
      attribute float aWidth;
      varying float vAlong;
      varying float vSide;
      varying vec3 vColor;
      varying float vSeed;
      varying float vGain;
      void main() {
        float sway = sin(uTime * 0.18 + aSeed * 6.2831) * 7.0;
        vec3 pos = position + vec3(aNormal * (aSide * aWidth + sway), 0.0);
        vAlong = aAlong;
        vSide = aSide;
        vColor = aColor;
        vSeed = aSeed;
        vGain = aGain;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      varying float vAlong;
      varying float vSide;
      varying vec3 vColor;
      varying float vSeed;
      varying float vGain;
      uniform float uTime;
      void main() {
        float core = exp(-vSide * vSide * 5.4);
        float travel = fract(vAlong * 1.35 - uTime * 0.045 + vSeed);
        float pulse = smoothstep(0.0, 0.018, travel) * smoothstep(0.22, 0.045, travel);
        float glow = core * (0.16 + pulse * 1.45) * vGain;
        gl_FragColor = vec4(vColor * (0.45 + pulse * 2.1), glow);
      }
    `,
  });

  const sparkMaterial = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime;
      attribute float aAlong;
      attribute float aSeed;
      attribute float aGain;
      attribute vec3 aColor;
      varying float vSpark;
      varying vec3 vColor;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * view;
        float travel = fract(aAlong - uTime * 0.05 + aSeed);
        vSpark = smoothstep(0.0, 0.02, travel) * smoothstep(0.12, 0.03, travel);
        vColor = aColor;
        gl_PointSize = (1.5 + vSpark * 4.2) * aGain;
      }
    `,
    fragmentShader: `
      varying float vSpark;
      varying vec3 vColor;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float disk = smoothstep(1.0, 0.2, length(p));
        float glow = disk * (0.18 + vSpark);
        if (glow < 0.02) discard;
        gl_FragColor = vec4(vColor, glow);
      }
    `,
  });

  const moteMaterial = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime;
      attribute float aSeed;
      attribute float aGain;
      attribute float aSize;
      attribute float aDrift;
      attribute float aPhase;
      attribute vec3 aColor;
      varying float vTwinkle;
      varying vec3 vColor;
      varying float vGain;
      void main() {
        float drift = sin(uTime * 0.32 + aPhase) * aDrift;
        float lift = cos(uTime * 0.24 + aPhase * 1.7) * aDrift;
        vec4 view = modelViewMatrix * vec4(position + vec3(drift, lift, 0.0), 1.0);
        gl_Position = projectionMatrix * view;
        vTwinkle = 0.5 + 0.5 * sin(uTime * (0.65 + aSeed * 0.9) + aPhase);
        vColor = aColor;
        vGain = aGain;
        gl_PointSize = aSize * (1.15 + vTwinkle * 0.85);
      }
    `,
    fragmentShader: `
      varying float vTwinkle;
      varying vec3 vColor;
      varying float vGain;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float dist = length(p);
        float disk = smoothstep(1.0, 0.08, dist);
        float core = smoothstep(0.48, 0.0, dist);
        float glow = disk * (0.5 + core * 1.15) * (0.62 + vTwinkle * 0.38) * vGain;
        if (glow < 0.035) discard;
        gl_FragColor = vec4(vColor * (0.75 + core * 0.7), glow);
      }
    `,
  });

  let ribbon: THREE.Mesh | null = null;
  let sparks: THREE.Points | null = null;
  let motes: THREE.Points | null = null;
  let composer: EffectComposer | null = null;
  const useBloom = window.innerWidth >= 960;

  const resize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();
    rebuild(width);
    if (useBloom) {
      composer?.setSize(width, height);
    }
  };

  const frameCamera = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const y = -window.scrollY - height / 2;
    camera.position.set(width / 2, y, 20);
    camera.lookAt(width / 2, y, 0);
  };

  const rebuild = (width: number) => {
    if (ribbon) {
      scene.remove(ribbon);
      ribbon.geometry.dispose();
    }
    if (sparks) {
      scene.remove(sparks);
      sparks.geometry.dispose();
    }
    if (motes) {
      scene.remove(motes);
      motes.geometry.dispose();
    }

    const compact = width < 760;
    const guides = createGuides(compact);
    const built = buildGeometry(guides, compact ? 22 : 36, compact);
    ribbon = new THREE.Mesh(built.ribbons, ribbonMaterial);
    ribbon.frustumCulled = false;
    sparks = new THREE.Points(built.sparks, sparkMaterial);
    sparks.frustumCulled = false;
    motes = new THREE.Points(built.motes, moteMaterial);
    motes.frustumCulled = false;
    scene.add(ribbon, sparks, motes);
  };

  if (useBloom) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.34, 0.4, 0.4));
    composer.addPass(new OutputPass());
  }

  resize();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => field.classList.add("light-field--live"));
  });

  let running = true;
  const clock = new THREE.Clock();

  const draw = () => {
    if (!running) {
      return;
    }
    uniforms.uTime.value += Math.min(clock.getDelta(), 0.05);
    frameCamera();
    if (composer) {
      composer.render();
    } else {
      renderer.render(scene, camera);
    }
    requestAnimationFrame(draw);
  };

  requestAnimationFrame(draw);
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    if (running) {
      clock.getDelta();
      requestAnimationFrame(draw);
    }
  });
}

function createGuides(compact: boolean): Guide[] {
  const hero = measure(".redesign-hero");
  const dashboard = measure(".workflow-dashboard");
  const portfolio = measure("#portfolio");
  const skills = measure("#skills");
  const beyond = measure("#beyond");
  const contact = measure("#contact");
  const guides: Guide[] = [];
  const density = compact ? 0.38 : 1;

  if (compact) {
    pushCompactGuides(guides);
    return guides;
  }

  if (hero) {
    const focus = dashboard
      ? { x: dashboard.x - hero.w * 0.03, y: dashboard.y + dashboard.h * 0.46 }
      : { x: hero.x + hero.w * 0.66, y: hero.y + hero.h * 0.46 };
    const left = hero.x - hero.w * 0.08;
    const right = hero.x + hero.w + hero.w * 0.08;
    const title = measure("#hero-title");
    const blurb = measure(".hero-copy > p:not(.status-badge):not(.status-line)");
    const paths = [
      [point(left, hero.y + hero.h * 0.14), point(hero.x + hero.w * 0.28, hero.y + hero.h * 0.02), focus, point(right, hero.y + hero.h * 0.58)],
      [point(left, hero.y + hero.h * 0.4), point(hero.x + hero.w * 0.12, hero.y + hero.h * 0.9), focus, point(right, hero.y + hero.h * 0.36)],
    ];
    for (const anchors of paths) {
      guides.push({
        anchors,
        count: Math.round(46 * density),
        spread: hero.h * 0.18,
        gain: 0.92,
        width: 2.4,
        focus: 0.64,
        dimStart: title ? title.x - 12 : hero.x + hero.w * 0.04,
        dimEnd: title ? title.x + title.w + 28 : hero.x + hero.w * 0.42,
        quiet: blurb
          ? { x: blurb.x - 28, y: blurb.y - 20, w: blurb.w + 56, h: blurb.h + 36 }
          : undefined,
        avoid: [title, blurb].flatMap((box) => (box ? [padBox(box, 28, 18)] : [])),
      });
    }
  }

  pushSweep(guides, portfolio, density, {
    ys: [0.05, -0.01, 0.12, 0.03],
    count: 18,
    spread: 70,
    gain: 0.36,
  });
  pushSweep(guides, portfolio, density, {
    ys: [0.58, 0.46, 0.66, 0.5],
    count: 16,
    spread: 80,
    gain: 0.24,
  });

  pushHeadingRibbon(guides, skills, measure("#skills-title"), density, {
    xs: [-0.04, 0.22, 0.62, 1.05],
    ys: [0.34, 0.08, -0.38, -0.1],
    focus: 0.72,
    shear: 64,
    spread: 50,
    belowText: true,
  });
  pushHeadingRibbon(guides, beyond, measure("#beyond-title"), density, {
    xs: [-0.05, 0.18, 0.55, 1.06],
    ys: [-0.46, -0.08, 0.55, 0.22],
    focus: 0.22,
    shear: -120,
    spread: 78,
  });
  pushHeadingRibbon(guides, contact, measure("#contact-title"), density, {
    xs: [-0.04, 0.28, 0.7, 1.05],
    ys: [0.1, 0.26, -0.12, -0.5],
    focus: 0.48,
    shear: 42,
    spread: 46,
    belowText: true,
  });

  return guides;
}

type ArcKind = "crown" | "climb" | "fall" | "hook";

function pushCompactGuides(guides: Guide[]) {
  const badge = layoutBox(".status-badge");
  const nav = layoutBox(".redesign-nav");
  const heroBox = layoutBox(".redesign-hero");
  const dashboardBox = layoutBox(".workflow-dashboard");
  if (heroBox && badge && nav) {
    pushAngledArc(guides, heroBox, nav.y + nav.h + 4, badge.y - 12, "crown", 0.9);
  }
  const status = layoutBox(".status-line");
  if (heroBox && status && dashboardBox) {
    pushAngledArc(guides, heroBox, status.y + status.h + 14, dashboardBox.y - 12, "fall", 0.86);
  }

  pushHeadingArc(guides, "#portfolio", "crown");
  pushHeadingArc(guides, "#skills", "climb");
  pushHeadingArc(guides, "#beyond", "fall");
  pushHeadingArc(guides, "#contact", "hook");
}

function pushHeadingArc(guides: Guide[], sectionSelector: string, kind: ArcKind) {
  const section = layoutBox(sectionSelector);
  const title = layoutBox(`${sectionSelector} h2`);
  const kicker = textBox(`${sectionSelector} .section-kicker`);
  if (!section || !title || !kicker) {
    return;
  }
  pushAngledArc(guides, section, section.y + 8, title.y - 26, kind, 0.84, {
    x: kicker.x + kicker.w + 16,
    y: kicker.y - 12,
  });
}

function pushAngledArc(
  guides: Guide[],
  section: Box,
  top: number,
  bottom: number,
  kind: ArcKind,
  gain: number,
  ceiling?: { x: number; y: number },
) {
  const room = bottom - top;
  if (room < 18) {
    return;
  }
  const shape: Record<ArcKind, { xs: number[]; ys: number[]; shear: number; focus: number }> = {
    crown: { xs: [-0.04, 0.26, 0.62, 1.04], ys: [0.82, 0.0, 0.16, 0.9], shear: -16, focus: 0.3 },
    climb: { xs: [-0.02, 0.34, 0.68, 1.05], ys: [0.9, 0.46, 0.14, 0.0], shear: 22, focus: 0.72 },
    fall: { xs: [-0.05, 0.24, 0.58, 1.04], ys: [0.0, 0.12, 0.58, 1.0], shear: -24, focus: 0.26 },
    hook: { xs: [0.0, 0.32, 0.66, 1.06], ys: [0.18, 0.42, 1.0, 0.0], shear: 18, focus: 0.55 },
  };
  const spec = shape[kind];
  const anchors = spec.xs.map((x, index) => {
    const px = section.x - 20 + (section.w + 40) * x;
    let py = top + room * spec.ys[index];
    if (ceiling && px < ceiling.x && py > ceiling.y) {
      py = ceiling.y;
    }
    return point(px, Math.min(bottom, Math.max(top, py)));
  });
  liftClear(anchors, bottom, ceiling);
  guides.push({
    anchors,
    count: 16,
    spread: Math.min(8, room * 0.12),
    gain,
    width: 1.65,
    focus: spec.focus,
    shear: spec.shear,
  });
}

function liftClear(anchors: Point[], floorY: number, ceiling?: { x: number; y: number }) {
  const curve = new THREE.CatmullRomCurve3(anchors.map((anchor) => new THREE.Vector3(anchor.x, anchor.y, 0)));
  let lift = 0;
  for (let step = 0; step <= 28; step += 1) {
    const sample = curve.getPoint(step / 28);
    if (sample.y > floorY) {
      lift = Math.max(lift, sample.y - floorY);
    }
    if (ceiling && sample.x < ceiling.x && sample.y > ceiling.y) {
      lift = Math.max(lift, sample.y - ceiling.y);
    }
  }
  if (lift > 0) {
    for (const anchor of anchors) {
      anchor.y -= lift;
    }
  }
}

function textBox(selector: string): Box | null {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    return null;
  }
  const range = document.createRange();
  range.selectNodeContents(element);
  const rect = range.getBoundingClientRect();
  return {
    x: rect.left + window.scrollX,
    y: rect.top + window.scrollY,
    w: rect.width,
    h: rect.height,
  };
}

function pushHeadingRibbon(
  guides: Guide[],
  section: Box | null,
  title: Box | null,
  density: number,
  shape: {
    xs: [number, number, number, number];
    ys: [number, number, number, number];
    focus: number;
    shear: number;
    spread: number;
    belowText?: boolean;
  },
) {
  if (!section || !title) {
    return;
  }

  const span = Math.max(140, Math.min(300, section.w * 0.2));
  const origin = shape.belowText ? title.y + title.h : title.y;
  const [x0, x1, x2, x3] = shape.xs;
  const [y0, y1, y2, y3] = shape.ys;
  const anchors = [
    point(section.x + section.w * x0, origin + span * y0),
    point(section.x + section.w * x1, origin + span * y1),
    point(section.x + section.w * x2, origin + span * y2),
    point(section.x + section.w * x3, origin + span * y3),
  ];

  if (shape.belowText) {
    const titleRight = title.x + title.w + 12;
    const curve = new THREE.CatmullRomCurve3(anchors.map((anchor) => new THREE.Vector3(anchor.x, anchor.y, 0)));
    const minY = title.y + title.h + 34;
    let shift = 0;
    for (let step = 0; step <= 32; step += 1) {
      const pointOnCurve = curve.getPoint(step / 32);
      if (pointOnCurve.x > titleRight) {
        continue;
      }
      if (pointOnCurve.y < minY) {
        shift = Math.max(shift, minY - pointOnCurve.y);
      }
    }
    if (shift > 0) {
      for (const anchor of anchors) {
        anchor.y += shift;
      }
    }

    if (title.w > section.w * 0.72) {
      const high = Math.min(...anchors.map((anchor) => anchor.y));
      const low = Math.max(...anchors.map((anchor) => anchor.y));
      const spanY = Math.max(1, low - high);
      const top = title.y + title.h + 12;
      for (const anchor of anchors) {
        anchor.y = top + ((anchor.y - high) / spanY) * 40;
      }
    }
  }

  guides.push({
    anchors,
    count: Math.max(8, Math.round(18 * density)),
    spread: density < 1 ? shape.spread * 0.55 : shape.spread,
    gain: 0.36,
    width: density < 1 ? 5.5 : 1.7,
    focus: shape.focus,
    shear: density < 1 ? shape.shear * 0.65 : shape.shear,
    avoid: [padBox(title, 22, 16)],
  });
}

function pushSweep(
  guides: Guide[],
  box: Box | null,
  density: number,
  options: { ys: [number, number, number, number]; count: number; spread: number; gain: number },
) {
  if (!box) {
    return;
  }

  const [y0, y1, y2, y3] = options.ys;
  guides.push({
    anchors: [
      point(box.x - 48, box.y + box.h * y0),
      point(box.x + box.w * 0.3, box.y + box.h * y1),
      point(box.x + box.w * 0.68, box.y + box.h * y2),
      point(box.x + box.w + 56, box.y + box.h * y3),
    ],
    count: Math.max(8, Math.round(options.count * density)),
    spread: options.spread,
    gain: options.gain,
    width: density < 1 ? 5.5 : 1.7,
    focus: 0.5,
  });
}

function buildGeometry(guides: Guide[], segments: number, compact: boolean) {
  const positions: number[] = [];
  const along: number[] = [];
  const sides: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const seeds: number[] = [];
  const gains: number[] = [];
  const widths: number[] = [];
  const indices: number[] = [];

  const sparkPositions: number[] = [];
  const sparkAlong: number[] = [];
  const sparkSeeds: number[] = [];
  const sparkGains: number[] = [];
  const sparkColors: number[] = [];

  const motePositions: number[] = [];
  const moteSeeds: number[] = [];
  const moteGains: number[] = [];
  const moteColors: number[] = [];
  const moteSizes: number[] = [];
  const moteDrifts: number[] = [];
  const motePhases: number[] = [];

  const lime = new THREE.Color("#c4ff4d");
  const cyan = new THREE.Color("#39d5e8");
  const white = new THREE.Color("#f3fff4");

  for (const guide of guides) {
    const curve = new THREE.CatmullRomCurve3(
      guide.anchors.map((anchor) => new THREE.Vector3(anchor.x, anchor.y, 0)),
    );

    for (let strand = 0; strand < guide.count; strand += 1) {
      const seed = strand / Math.max(1, guide.count - 1);
      const signed = seed * 2 - 1;
      const color = seed > 0.58 ? cyan : lime;
      const base = positions.length / 3;

      for (let step = 0; step <= segments; step += 1) {
        const t = step / segments;
        const center = curve.getPoint(t);
        const tangent = curve.getTangent(t);
        const length = Math.hypot(tangent.x, tangent.y) || 1;
        const nx = -tangent.y / length;
        const ny = tangent.x / length;
        const pinch = 0.34 + 0.66 * Math.abs(t - guide.focus);
        const wave = Math.sin(t * Math.PI * (1.4 + seed * 3) + seed * 8);
        const offset = signed * guide.spread * pinch + wave * guide.spread * 0.07;
        const drift = (guide.shear ?? 0) * signed * (t - guide.focus);
        const x = center.x + nx * offset;
        const y = center.y + ny * offset + drift;

        const brightness = ribbonBrightness(x, y, guide);

        for (const side of [-1, 1]) {
          positions.push(x, -y, 0);
          along.push(t);
          sides.push(side);
          normals.push(nx, -ny);
          colors.push(color.r, color.g, color.b);
          seeds.push(seed);
          gains.push(guide.gain * brightness);
          widths.push(guide.width);
        }

        if (step % 4 === 0 && strand % 2 === 0) {
          sparkPositions.push(x, -y, 0);
          sparkAlong.push(t);
          sparkSeeds.push(seed);
          sparkGains.push(guide.gain * brightness);
          sparkColors.push(color.r, color.g, color.b);
        }

        if (step < segments) {
          const left = base + step * 2;
          const right = left + 1;
          const nextLeft = left + 2;
          const nextRight = left + 3;
          indices.push(left, right, nextLeft, right, nextRight, nextLeft);
        }
      }
    }

    const moteCount = compact ? 52 : guide.count > 30 ? 340 : 120;
    for (let mote = 0; mote < moteCount; mote += 1) {
      const n = mote * 1.17 + guide.anchors[0].x * 0.013 + guide.anchors[0].y * 0.017 + guide.spread * 0.02;
      const t = hash(n + 0.17);
      const center = curve.getPoint(t);
      const tangent = curve.getTangent(t);
      const length = Math.hypot(tangent.x, tangent.y) || 1;
      const nx = -tangent.y / length;
      const ny = tangent.x / length;
      const halo = compact ? 2 + hash(n + 1.1) * 7 : guide.spread * (0.02 + hash(n + 1.1) * 0.62);
      const side = hash(n + 2.3) * 2 - 1;
      const along = (hash(n + 3.7) - 0.5) * (compact ? 8 : guide.spread * 0.2);
      const x = center.x + nx * side * halo + (tangent.x / length) * along;
      const y = center.y + ny * side * halo + (tangent.y / length) * along;
      if (overlapsBox(x, y, guide.avoid)) {
        continue;
      }
      const orb = hash(n + 8.2) > 0.82;
      const color = (hash(n + 4.8) > 0.36 ? lime : cyan).clone();
      if (hash(n + 5.6) > 0.74) {
        color.lerp(white, 0.7);
      }
      motePositions.push(x, -y, 0);
      moteSeeds.push(hash(n + 6.1));
      moteGains.push(Math.min(1.15, guide.gain * 1.45) * (orb ? 0.72 : 0.78 + hash(n + 7.4) * 0.5));
      moteColors.push(color.r, color.g, color.b);
      moteSizes.push(orb ? 3.6 + hash(n + 9.3) * 2.4 : 1.7 + hash(n + 9.3) * 2.1);
      moteDrifts.push((compact ? 2 : 6) + hash(n + 10.5) * (compact ? 2.5 : 8));
      motePhases.push(hash(n + 11.2) * Math.PI * 2);
    }
  }

  const ribbons = new THREE.BufferGeometry();
  ribbons.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  ribbons.setAttribute("aAlong", new THREE.Float32BufferAttribute(along, 1));
  ribbons.setAttribute("aSide", new THREE.Float32BufferAttribute(sides, 1));
  ribbons.setAttribute("aNormal", new THREE.Float32BufferAttribute(normals, 2));
  ribbons.setAttribute("aColor", new THREE.Float32BufferAttribute(colors, 3));
  ribbons.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
  ribbons.setAttribute("aGain", new THREE.Float32BufferAttribute(gains, 1));
  ribbons.setAttribute("aWidth", new THREE.Float32BufferAttribute(widths, 1));
  ribbons.setIndex(indices);
  ribbons.computeBoundingSphere();

  const sparks = new THREE.BufferGeometry();
  sparks.setAttribute("position", new THREE.Float32BufferAttribute(sparkPositions, 3));
  sparks.setAttribute("aAlong", new THREE.Float32BufferAttribute(sparkAlong, 1));
  sparks.setAttribute("aSeed", new THREE.Float32BufferAttribute(sparkSeeds, 1));
  sparks.setAttribute("aGain", new THREE.Float32BufferAttribute(sparkGains, 1));
  sparks.setAttribute("aColor", new THREE.Float32BufferAttribute(sparkColors, 3));

  const motes = new THREE.BufferGeometry();
  const moteFallback = motePositions.length > 0 ? motePositions : [0, 0, 0];
  motes.setAttribute("position", new THREE.Float32BufferAttribute(moteFallback, 3));
  motes.setAttribute("aSeed", new THREE.Float32BufferAttribute(moteSeeds.length ? moteSeeds : [0], 1));
  motes.setAttribute("aGain", new THREE.Float32BufferAttribute(moteGains.length ? moteGains : [0], 1));
  motes.setAttribute("aColor", new THREE.Float32BufferAttribute(moteColors.length ? moteColors : [0, 0, 0], 3));
  motes.setAttribute("aSize", new THREE.Float32BufferAttribute(moteSizes.length ? moteSizes : [0], 1));
  motes.setAttribute("aDrift", new THREE.Float32BufferAttribute(moteDrifts.length ? moteDrifts : [0], 1));
  motes.setAttribute("aPhase", new THREE.Float32BufferAttribute(motePhases.length ? motePhases : [0], 1));

  return { ribbons, sparks, motes };
}

function hash(value: number) {
  const raw = Math.sin(value * 127.1) * 43758.5453;
  return raw - Math.floor(raw);
}

function layoutBox(selector: string): Box | null {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    return null;
  }
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = element;
  while (node) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y, w: element.offsetWidth, h: element.offsetHeight };
}

function measure(selector: string): Box | null {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    return null;
  }
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + window.scrollX,
    y: rect.top + window.scrollY,
    w: rect.width,
    h: rect.height,
  };
}

function point(x: number, y: number): Point {
  return { x, y };
}

function padBox(box: Box, xPad: number, yPad: number): Box {
  return { x: box.x - xPad, y: box.y - yPad, w: box.w + xPad * 2, h: box.h + yPad * 2 };
}

function overlapsBox(x: number, y: number, boxes: Box[] | undefined) {
  if (!boxes) {
    return false;
  }
  return boxes.some((box) => x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h);
}

function ribbonBrightness(x: number, y: number, guide: Guide) {
  let brightness = 1;
  if (guide.dimStart != null && guide.dimEnd != null) {
    const fade = 120;
    const overText =
      smoothstep(guide.dimStart - fade, guide.dimStart + 20, x) *
      (1 - smoothstep(guide.dimEnd - 16, guide.dimEnd + fade, x));
    brightness = 1 - overText * 0.34;
  }

  const quiet = guide.quiet;
  if (quiet) {
    const fade = 22;
    const inside =
      smoothstep(quiet.x - fade, quiet.x + 4, x) *
      (1 - smoothstep(quiet.x + quiet.w - 4, quiet.x + quiet.w + fade, x)) *
      smoothstep(quiet.y - fade, quiet.y + 4, y) *
      (1 - smoothstep(quiet.y + quiet.h - 4, quiet.y + quiet.h + fade, y));
    brightness *= 1 - inside * 0.92;
  }

  return brightness;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const span = edge1 - edge0 || 1;
  const t = Math.min(1, Math.max(0, (value - edge0) / span));
  return t * t * (3 - 2 * t);
}
