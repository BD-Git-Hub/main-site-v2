import * as THREE from "three";

type ParticleSource = {
  colors: Float32Array;
  normalized: Float32Array;
  seeds: Float32Array;
  count: number;
  aspect: number;
};

const coverLayers = [
  "/media/images/coverartimg/lightbluesky.png",
  "/media/images/coverartimg/smallmoon.png",
  "/media/images/coverartimg/biggermoon.png",
  "/media/images/coverartimg/pinkbackgroundcloud.png",
  "/media/images/coverartimg/purplebackgroundcloud.png",
  "/media/images/coverartimg/blueocean.png",
  "/media/images/coverartimg/people.png",
  "/media/images/coverartimg/piergrinds.png",
  "/media/images/coverartimg/orangesands.png",
  "/media/images/coverartimg/darkerorange.png",
  "/media/images/coverartimg/big%20birds.png",
  "/media/images/coverartimg/medium%20birds.png",
  "/media/images/coverartimg/small%20birds.png",
  "/media/images/coverartimg/pier.png",
];

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load ${src}`));
    image.src = src;
  });

const buildParticleSource = async (): Promise<ParticleSource> => {
  const images = await Promise.all(coverLayers.map(loadImage));
  const width = 860;
  const height = 232;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Canvas 2D context is unavailable");
  }

  canvas.width = width;
  canvas.height = height;
  context.clearRect(0, 0, width, height);

  for (const image of images) {
    context.drawImage(image, 0, 0, width, height);
  }

  const { data } = context.getImageData(0, 0, width, height);
  const colors: number[] = [];
  const normalized: number[] = [];
  const seeds: number[] = [];
  const step = window.innerWidth < 720 ? 6 : 5;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = (y * width + x) * 4;
      const alpha = data[index + 3];

      if (alpha < 24) {
        continue;
      }

      const red = data[index] / 255;
      const green = data[index + 1] / 255;
      const blue = data[index + 2] / 255;
      const brightness = (red + green + blue) / 3;

      if (brightness < 0.08 && Math.random() > 0.4) {
        continue;
      }

      normalized.push(x / width - 0.5, 0.5 - y / height, (Math.random() - 0.5) * 0.34);
      colors.push(red, green, blue);
      seeds.push(Math.random());
    }
  }

  return {
    colors: new Float32Array(colors),
    normalized: new Float32Array(normalized),
    seeds: new Float32Array(seeds),
    count: seeds.length,
    aspect: width / height,
  };
};

const startParticleHero = async () => {
  const canvas = document.querySelector<HTMLCanvasElement>("#particle-hero");
  const hero = canvas?.closest<HTMLElement>(".hero");

  if (!canvas || !hero) {
    return;
  }

  let renderer: THREE.WebGLRenderer;

  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
  } catch (error) {
    console.warn("WebGL renderer could not start.", error);
    return;
  }

  const source = await buildParticleSource();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 1, 1600);
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(source.count * 3);
  const basePositions = new Float32Array(source.count * 3);

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(source.colors, 3));

  const material = new THREE.PointsMaterial({
    size: window.innerWidth < 720 ? 2.15 : 2.9,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);

  const pointer = new THREE.Vector2(0, 0);
  const targetPointer = new THREE.Vector2(0, 0);
  let animationFrame = 0;

  const writeBasePositions = () => {
    const rect = hero.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.z = 520;
    camera.updateProjectionMatrix();

    const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * camera.position.z;
    const viewWidth = viewHeight * camera.aspect;
    let planeWidth = viewWidth * (width < 720 ? 1.38 : 1.04);
    let planeHeight = planeWidth / source.aspect;
    const maxPlaneHeight = viewHeight * (width < 720 ? 0.55 : 0.62);

    if (planeHeight > maxPlaneHeight) {
      planeHeight = maxPlaneHeight;
      planeWidth = planeHeight * source.aspect;
    }

    for (let i = 0; i < source.count; i += 1) {
      const i3 = i * 3;
      basePositions[i3] = source.normalized[i3] * planeWidth;
      basePositions[i3 + 1] = source.normalized[i3 + 1] * planeHeight;
      basePositions[i3 + 2] = source.normalized[i3 + 2] * 260;
      positions[i3] = basePositions[i3];
      positions[i3 + 1] = basePositions[i3 + 1];
      positions[i3 + 2] = basePositions[i3 + 2];
    }

    geometry.attributes.position.needsUpdate = true;
  };

  const onPointerMove = (event: PointerEvent) => {
    const rect = hero.getBoundingClientRect();
    targetPointer.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    targetPointer.y = -(((event.clientY - rect.top) / rect.height - 0.5) * 2);
  };

  const onPointerLeave = () => {
    targetPointer.set(0, 0);
  };

  const render = (time: number) => {
    pointer.lerp(targetPointer, 0.045);

    const motion = prefersReducedMotion ? 0.18 : 1;
    const positionAttribute = geometry.attributes.position as THREE.BufferAttribute;
    const positionArray = positionAttribute.array as Float32Array;
    const pulse = Math.sin(time * 0.00028) * 0.018 * motion;

    for (let i = 0; i < source.count; i += 1) {
      const i3 = i * 3;
      const seed = source.seeds[i];
      const wave = Math.sin(time * 0.001 + seed * 8.0) * 7.2 * motion;
      const slowWave = Math.cos(time * 0.00052 + seed * 10.0) * 4.6 * motion;

      positionArray[i3] = basePositions[i3] + pointer.x * (8 + seed * 16) * motion + slowWave;
      positionArray[i3 + 1] = basePositions[i3 + 1] + pointer.y * (6 + seed * 14) * motion + wave * 0.42;
      positionArray[i3 + 2] = basePositions[i3 + 2] + wave + pointer.x * seed * 28 * motion;
    }

    positionAttribute.needsUpdate = true;
    points.scale.setScalar(1 + pulse);
    points.rotation.y = pointer.x * 0.07 * motion;
    points.rotation.x = -pointer.y * 0.035 * motion;
    points.rotation.z = Math.sin(time * 0.00018) * 0.006 * motion;

    renderer.render(scene, camera);
    animationFrame = window.requestAnimationFrame(render);
  };

  writeBasePositions();
  hero.addEventListener("pointermove", onPointerMove);
  hero.addEventListener("pointerleave", onPointerLeave);
  window.addEventListener("resize", writeBasePositions);
  animationFrame = window.requestAnimationFrame(render);

  document.addEventListener(
    "astro:before-swap",
    () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", writeBasePositions);
      hero.removeEventListener("pointermove", onPointerMove);
      hero.removeEventListener("pointerleave", onPointerLeave);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
    { once: true },
  );
};

void startParticleHero();
