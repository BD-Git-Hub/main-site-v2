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

  let ribbon: THREE.Mesh | null = null;
  let sparks: THREE.Points | null = null;
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

    const compact = width < 760;
    const guides = createGuides(compact);
    const built = buildGeometry(guides, compact ? 22 : 36);
    ribbon = new THREE.Mesh(built.ribbons, ribbonMaterial);
    ribbon.frustumCulled = false;
    sparks = new THREE.Points(built.sparks, sparkMaterial);
    sparks.frustumCulled = false;
    scene.add(ribbon, sparks);
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

  if (hero) {
    const focus = dashboard
      ? { x: dashboard.x - hero.w * 0.03, y: dashboard.y + dashboard.h * 0.46 }
      : { x: hero.x + hero.w * 0.66, y: hero.y + hero.h * 0.46 };
    const left = hero.x - hero.w * 0.08;
    const right = hero.x + hero.w + hero.w * 0.08;
    const title = measure("#hero-title");
    const blurb = measure(".hero-copy > p:not(.status-badge):not(.status-line)");
    const paths = [
      [point(left, hero.y + hero.h * 0.74), point(hero.x + hero.w * 0.18, hero.y + hero.h * 0.16), focus, point(right, hero.y + hero.h * 0.08)],
      [point(left, hero.y + hero.h * 0.4), point(hero.x + hero.w * 0.12, hero.y + hero.h * 0.9), focus, point(right, hero.y + hero.h * 0.36)],
      [point(left, hero.y + hero.h * 0.14), point(hero.x + hero.w * 0.28, hero.y + hero.h * 0.02), focus, point(right, hero.y + hero.h * 0.58)],
    ];
    for (const anchors of paths) {
      guides.push({
        anchors,
        count: Math.round(46 * density),
        spread: hero.h * 0.18,
        gain: compact ? 0.28 : 0.92,
        width: compact ? 8 : 2.4,
        focus: 0.64,
        dimStart: title ? title.x - 12 : hero.x + hero.w * 0.04,
        dimEnd: title ? title.x + title.w + 28 : hero.x + hero.w * 0.42,
        quiet: blurb
          ? { x: blurb.x - 28, y: blurb.y - 20, w: blurb.w + 56, h: blurb.h + 36 }
          : undefined,
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

function buildGeometry(guides: Guide[], segments: number) {
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

  const lime = new THREE.Color("#c4ff4d");
  const cyan = new THREE.Color("#39d5e8");

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

  return { ribbons, sparks };
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
