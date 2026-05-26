import * as THREE from "/vendor/three.module.min.js";

const earthRoots = Array.from(document.querySelectorAll("[data-earth-3d]"));

if (earthRoots.length && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  earthRoots.forEach((root) => {
    const canvas = root.querySelector("canvas");
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 80);
    camera.position.set(0, 0, 8.2);

    const ambient = new THREE.AmbientLight(0xb8d7ff, 1.1);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 4.6);
    sun.position.set(4.8, 2.6, 5.4);
    scene.add(sun);

    const rim = new THREE.DirectionalLight(0x5eeaff, 1.75);
    rim.position.set(-5.8, -0.8, -2.4);
    scene.add(rim);

    const cameraFill = new THREE.DirectionalLight(0xdbeafe, 1.25);
    cameraFill.position.set(0.2, 0.1, 5);
    scene.add(cameraFill);

    const loader = new THREE.TextureLoader();
    const textureBase = "/textures/earth/";
    const earthMap = loader.load(`${textureBase}earth_atmos_2048.jpg`);
    const specularMap = loader.load(`${textureBase}earth_specular_2048.jpg`);
    const cloudMap = loader.load(`${textureBase}earth_clouds_1024.png`);

    [earthMap, specularMap, cloudMap].forEach((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    });

    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(2.42, 64, 40),
      new THREE.MeshPhongMaterial({
        color: 0x5aa7e8,
        map: earthMap,
        specularMap,
        specular: new THREE.Color(0x2f6d95),
        shininess: 18,
        emissive: new THREE.Color(0x0c2f4a),
        emissiveIntensity: 0.12
      })
    );
    earth.rotation.set(0.24, -0.54, -0.08);
    scene.add(earth);

    const daylightOverlay = new THREE.Mesh(
      new THREE.SphereGeometry(2.425, 64, 40),
      new THREE.MeshBasicMaterial({
        map: earthMap,
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    daylightOverlay.rotation.copy(earth.rotation);
    scene.add(daylightOverlay);

    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(2.47, 64, 40),
      new THREE.MeshLambertMaterial({
        map: cloudMap,
        transparent: true,
        opacity: 0.48,
        depthWrite: false
      })
    );
    clouds.rotation.copy(earth.rotation);
    scene.add(clouds);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(2.54, 64, 40),
      new THREE.MeshBasicMaterial({
        color: 0x6ee7ff,
        transparent: true,
        opacity: 0.16,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    scene.add(atmosphere);

    const starGeometry = new THREE.BufferGeometry();
    const starCount = 36;
    const starPositions = new Float32Array(starCount * 3);
    for (let index = 0; index < starCount; index += 1) {
      const radius = 9 + Math.random() * 13;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[index * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      starPositions[index * 3 + 2] = radius * Math.cos(phi);
    }
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.035,
        transparent: true,
        opacity: 0.58,
        depthWrite: false
      })
    );
    scene.add(stars);

    function resize() {
      const box = root.getBoundingClientRect();
      const width = Math.max(1, Math.round(box.width));
      const height = Math.max(1, Math.round(box.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(root);
    resize();

    const startTime = performance.now();
    function animate() {
      const time = (performance.now() - startTime) / 1000;
      earth.rotation.y = -0.54 + time * 0.075;
      daylightOverlay.rotation.y = earth.rotation.y;
      daylightOverlay.rotation.x = earth.rotation.x;
      daylightOverlay.rotation.z = earth.rotation.z;
      clouds.rotation.y = -0.38 + time * 0.104;
      atmosphere.scale.setScalar(1 + Math.sin(time * 1.25) * 0.015);
      stars.rotation.y = time * 0.012;
      stars.rotation.x = Math.sin(time * 0.18) * 0.03;
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }

    animate();
  });
}

const planetRoots = Array.from(document.querySelectorAll("[data-planet-3d-active]"));

if (planetRoots.length && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const makeTexture = (palette, variant = "bands") => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    palette.forEach((stop, index) => gradient.addColorStop(index / Math.max(1, palette.length - 1), stop));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const rand = (seed) => {
      const x = Math.sin(seed * 999.91) * 10000;
      return x - Math.floor(x);
    };

    if (variant === "gas") {
      for (let y = 0; y < canvas.height; y += 9) {
        const wave = Math.sin(y * 0.028) * 34 + Math.sin(y * 0.071) * 12;
        ctx.fillStyle = `rgba(255,255,255,${0.035 + (y % 47) / 1800})`;
        ctx.beginPath();
        ctx.moveTo(0, y + wave);
        for (let x = 0; x <= canvas.width; x += 26) {
          ctx.lineTo(x, y + wave + Math.sin(x * 0.022 + y * 0.04) * 16);
        }
        ctx.lineTo(canvas.width, y + 16);
        ctx.lineTo(0, y + 16);
        ctx.closePath();
        ctx.fill();
      }
    } else if (variant === "rock") {
      for (let i = 0; i < 130; i += 1) {
        const x = rand(i + 4) * canvas.width;
        const y = rand(i + 19) * canvas.height;
        const radius = 6 + rand(i + 44) * 42;
        const crater = ctx.createRadialGradient(x, y, 0, x, y, radius);
        crater.addColorStop(0, "rgba(255,255,255,0.12)");
        crater.addColorStop(0.38, "rgba(0,0,0,0.16)");
        crater.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = crater;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      for (let i = 0; i < 60; i += 1) {
        const x = rand(i + 2) * canvas.width;
        const y = rand(i + 31) * canvas.height;
        const w = 70 + rand(i + 70) * 180;
        const h = 14 + rand(i + 94) * 44;
        ctx.fillStyle = `rgba(255,255,255,${0.04 + rand(i + 120) * 0.08})`;
        ctx.beginPath();
        ctx.ellipse(x, y, w, h, rand(i + 6) * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  };

  const configs = {
    blue: {
      palette: ["#071a55", "#1d4ed8", "#38bdf8", "#172554"],
      variant: "bands",
      emissive: 0x102a64,
      rotationSpeed: 0.18
    },
    red: {
      palette: ["#450a0a", "#be123c", "#fb7185", "#7f1d1d"],
      variant: "rock",
      emissive: 0x4a1015,
      rotationSpeed: 0.13
    },
    teal: {
      palette: ["#042f2e", "#0f766e", "#2dd4bf", "#134e4a"],
      variant: "bands",
      emissive: 0x0d3b42,
      rotationSpeed: 0.16
    },
    gas: {
      palette: ["#451a03", "#b45309", "#fde68a", "#92400e", "#3f1d05"],
      variant: "gas",
      emissive: 0x4a2608,
      rotationSpeed: 0.11,
      ring: true
    }
  };

  planetRoots.forEach((rootEl) => {
    const type = rootEl.getAttribute("data-planet-3d") || "blue";
    const config = configs[type] || configs.blue;
    const canvas = rootEl.querySelector("canvas");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
    camera.position.set(0, 0, config.ring ? 9.8 : 7.8);

    scene.add(new THREE.AmbientLight(0xaecbff, 0.45));
    const key = new THREE.DirectionalLight(0xffffff, 3.4);
    key.position.set(4, 2.4, 5.8);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x67e8f9, 0.8);
    fill.position.set(-4, -1, 2);
    scene.add(fill);

    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(2.25, 96, 64),
      new THREE.MeshStandardMaterial({
        map: makeTexture(config.palette, config.variant),
        roughness: config.variant === "gas" ? 0.78 : 0.62,
        metalness: 0.02,
        emissive: new THREE.Color(config.emissive),
        emissiveIntensity: 0.07
      })
    );
    planet.rotation.set(0.18, -0.42, -0.08);
    scene.add(planet);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(2.34, 96, 64),
      new THREE.MeshBasicMaterial({
        color: type === "red" ? 0xff9ca8 : type === "gas" ? 0xfde68a : 0x67e8f9,
        transparent: true,
        opacity: 0.1,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    scene.add(atmosphere);

    let ring = null;
    if (config.ring) {
      const ringTexture = makeTexture(["#fef3c7", "#d97706", "#78350f", "#fbbf24"], "gas");
      ring = new THREE.Mesh(
        new THREE.RingGeometry(2.78, 3.72, 160),
        new THREE.MeshBasicMaterial({
          map: ringTexture,
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      );
      ring.rotation.x = Math.PI / 2.35;
      ring.rotation.y = -0.24;
      scene.add(ring);
    }

    function resizePlanet() {
      const box = rootEl.getBoundingClientRect();
      const width = Math.max(1, Math.round(box.width));
      const height = Math.max(1, Math.round(box.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    const observer = new ResizeObserver(resizePlanet);
    observer.observe(rootEl);
    resizePlanet();

    const startTime = performance.now();
    function renderPlanet() {
      const time = (performance.now() - startTime) / 1000;
      planet.rotation.y = -0.42 + time * config.rotationSpeed;
      planet.rotation.x = 0.18 + Math.sin(time * 0.35) * 0.035;
      atmosphere.scale.setScalar(1 + Math.sin(time * 1.2) * 0.012);
      if (ring) ring.rotation.z = time * 0.08;
      renderer.render(scene, camera);
      requestAnimationFrame(renderPlanet);
    }

    renderPlanet();
  });
}

const objectRoots = Array.from(document.querySelectorAll("[data-space-object-3d-active]"));

if (objectRoots.length && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const metal = (color, roughness = 0.34, metalness = 0.82) => new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness
  });

  const glass = (color, opacity = 0.58) => new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.05,
    metalness: 0,
    transmission: 0.28,
    transparent: true,
    opacity,
    clearcoat: 1,
    clearcoatRoughness: 0.04
  });

  const makeCanvasTexture = (colors) => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    colors.forEach((color, index) => gradient.addColorStop(index / Math.max(1, colors.length - 1), color));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(255,255,255,0.26)";
    ctx.lineWidth = 2;
    for (let x = 0; x < canvas.width; x += 42) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 18, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 34) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  };

  const makeRoundedBox = (width, height, depth, radius = 0.06) => {
    const shape = new THREE.Shape();
    const x = -width / 2;
    const y = -height / 2;
    shape.moveTo(x + radius, y);
    shape.lineTo(x + width - radius, y);
    shape.quadraticCurveTo(x + width, y, x + width, y + radius);
    shape.lineTo(x + width, y + height - radius);
    shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    shape.lineTo(x + radius, y + height);
    shape.quadraticCurveTo(x, y + height, x, y + height - radius);
    shape.lineTo(x, y + radius);
    shape.quadraticCurveTo(x, y, x + radius, y);
    return new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelSegments: 5,
      bevelSize: radius * 0.42,
      bevelThickness: radius * 0.42
    }).center();
  };

  const buildUfo = () => {
    const group = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.SphereGeometry(1.95, 96, 32, 0, Math.PI * 2, Math.PI * 0.37, Math.PI * 0.46),
      metal(0xb9c4d4, 0.22, 0.88)
    );
    hull.scale.set(1.65, 0.34, 1);
    hull.rotation.x = Math.PI;
    group.add(hull);

    const under = new THREE.Mesh(
      new THREE.CylinderGeometry(1.25, 1.85, 0.28, 96),
      metal(0x667085, 0.28, 0.9)
    );
    under.position.y = -0.16;
    group.add(under);

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.76, 64, 32, 0, Math.PI * 2, 0, Math.PI * 0.5),
      glass(0x67e8f9, 0.52)
    );
    dome.scale.set(1.18, 0.7, 1.18);
    dome.position.y = 0.23;
    group.add(dome);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(1.72, 0.055, 16, 128),
      metal(0xe2e8f0, 0.18, 0.92)
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.02;
    group.add(rim);

    for (let index = 0; index < 10; index += 1) {
      const light = new THREE.Mesh(
        new THREE.SphereGeometry(0.075, 18, 12),
        new THREE.MeshBasicMaterial({ color: index % 2 ? 0x67e8f9 : 0xfef3c7 })
      );
      const angle = (index / 10) * Math.PI * 2;
      light.position.set(Math.cos(angle) * 1.55, -0.2, Math.sin(angle) * 0.84);
      group.add(light);
    }

    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(0.86, 2.5, 48, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x67e8f9,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    beam.position.y = -1.52;
    beam.rotation.x = Math.PI;
    group.add(beam);

    group.rotation.set(-0.18, 0.28, -0.08);
    group.scale.setScalar(1.15);
    return group;
  };

  const buildSatellite = () => {
    const group = new THREE.Group();
    const panelMap = makeCanvasTexture(["#0f172a", "#1d4ed8", "#38bdf8", "#1e3a8a"]);
    const panelMaterial = new THREE.MeshStandardMaterial({
      map: panelMap,
      roughness: 0.42,
      metalness: 0.18,
      emissive: new THREE.Color(0x102a64),
      emissiveIntensity: 0.12
    });

    const body = new THREE.Mesh(makeRoundedBox(0.82, 0.58, 0.62, 0.09), metal(0xd8dee9, 0.26, 0.72));
    body.rotation.y = 0.16;
    group.add(body);

    const leftPanel = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.7, 0.045), panelMaterial);
    leftPanel.position.x = -1.12;
    group.add(leftPanel);

    const rightPanel = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.7, 0.045), panelMaterial);
    rightPanel.position.x = 1.12;
    group.add(rightPanel);

    const armMaterial = metal(0xcbd5e1, 0.28, 0.78);
    [-0.56, 0.56].forEach((x) => {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.42, 12), armMaterial);
      arm.rotation.z = Math.PI / 2;
      arm.position.x = x;
      group.add(arm);
    });

    const dish = new THREE.Mesh(
      new THREE.ConeGeometry(0.36, 0.25, 48, 1, true),
      metal(0xe5e7eb, 0.2, 0.86)
    );
    dish.position.set(0.22, -0.5, 0.32);
    dish.rotation.x = Math.PI * 0.62;
    group.add(dish);

    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.58, 12), armMaterial);
    antenna.position.set(-0.24, 0.48, 0.08);
    antenna.rotation.z = -0.55;
    group.add(antenna);

    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), new THREE.MeshBasicMaterial({ color: 0x67e8f9 }));
    tip.position.set(-0.42, 0.72, 0.08);
    group.add(tip);

    group.rotation.set(-0.12, -0.38, -0.24);
    group.scale.setScalar(1.18);
    return group;
  };

  const buildAstronaut = () => {
    const group = new THREE.Group();
    const suit = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.46, metalness: 0.08 });
    const trim = metal(0x94a3b8, 0.3, 0.38);
    const darkGlass = glass(0x0f3a74, 0.86);

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.54, 64, 32), suit);
    helmet.position.y = 1.18;
    group.add(helmet);

    const visor = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 48, 24, -Math.PI * 0.18, Math.PI * 0.72, Math.PI * 0.25, Math.PI * 0.38),
      darkGlass
    );
    visor.position.set(0, 1.16, 0.33);
    visor.scale.set(1.12, 0.72, 0.42);
    group.add(visor);

    const neck = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.055, 16, 64), trim);
    neck.position.y = 0.72;
    neck.rotation.x = Math.PI / 2;
    group.add(neck);

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.72, 14, 28), suit);
    body.position.y = 0.1;
    body.scale.set(1.05, 1, 0.72);
    group.add(body);

    const chest = new THREE.Mesh(makeRoundedBox(0.42, 0.28, 0.08, 0.045), metal(0xe2e8f0, 0.24, 0.32));
    chest.position.set(0, 0.2, 0.41);
    group.add(chest);

    [[-0.12, 0xef4444], [0, 0x22c55e], [0.12, 0x38bdf8]].forEach(([x, color]) => {
      const button = new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 10), new THREE.MeshBasicMaterial({ color }));
      button.position.set(x, 0.23, 0.47);
      group.add(button);
    });

    const backpack = new THREE.Mesh(makeRoundedBox(0.56, 0.72, 0.18, 0.08), metal(0xcbd5e1, 0.34, 0.28));
    backpack.position.set(0, 0.1, -0.42);
    group.add(backpack);

    const limb = (x, y, z, rotZ, length = 0.72) => {
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, length, 10, 18), suit);
      mesh.position.set(x, y, z);
      mesh.rotation.z = rotZ;
      mesh.rotation.x = z > 0 ? 0.18 : -0.12;
      group.add(mesh);
      return mesh;
    };
    limb(-0.52, 0.22, 0.02, -0.36, 0.66);
    limb(0.52, 0.18, 0.03, 0.42, 0.66);
    limb(-0.22, -0.72, 0.02, 0.12, 0.72);
    limb(0.24, -0.72, 0.02, -0.18, 0.72);

    [-0.3, 0.3].forEach((x) => {
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.38), trim);
      boot.position.set(x, -1.2, 0.14);
      boot.rotation.z = x < 0 ? 0.12 : -0.16;
      group.add(boot);
    });

    const tether = new THREE.Mesh(
      new THREE.TorusGeometry(1.2, 0.012, 8, 120, Math.PI * 1.14),
      new THREE.MeshBasicMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0.56 })
    );
    tether.position.set(-1.1, 0.32, -0.08);
    tether.rotation.set(0.3, 0.2, 0.28);
    group.add(tether);

    group.rotation.set(0.08, -0.28, 0.18);
    group.scale.setScalar(0.86);
    return group;
  };

  const builders = {
    ufo: buildUfo,
    satellite: buildSatellite,
    astronaut: buildAstronaut
  };

  objectRoots.forEach((rootEl) => {
    const type = rootEl.getAttribute("data-space-object-3d") || "ufo";
    const canvas = rootEl.querySelector("canvas");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = type === "astronaut" ? 1.12 : 1.02;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(type === "astronaut" ? 32 : 30, 1, 0.1, 70);
    camera.position.set(0, 0, type === "astronaut" ? 6.4 : 7.2);

    scene.add(new THREE.AmbientLight(0xc7ddff, 0.72));
    const key = new THREE.DirectionalLight(0xffffff, 3.5);
    key.position.set(4, 3, 5.4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x67e8f9, 1.7);
    rim.position.set(-4, -1.2, -2.4);
    scene.add(rim);

    const model = (builders[type] || buildUfo)();
    scene.add(model);

    function resizeObject() {
      const box = rootEl.getBoundingClientRect();
      const width = Math.max(1, Math.round(box.width));
      const height = Math.max(1, Math.round(box.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    const observer = new ResizeObserver(resizeObject);
    observer.observe(rootEl);
    resizeObject();

    const startTime = performance.now();
    const baseRotation = {
      x: model.rotation.x,
      y: model.rotation.y,
      z: model.rotation.z
    };
    function renderObject() {
      const time = (performance.now() - startTime) / 1000;
      model.rotation.y = baseRotation.y + (type === "ufo" ? time * 0.7 : type === "satellite" ? Math.sin(time * 0.34) * 0.38 : Math.sin(time * 0.36) * 0.12);
      model.rotation.x = baseRotation.x + (type === "satellite" ? Math.sin(time * 0.27) * 0.14 : 0);
      model.position.y = Math.sin(time * (type === "ufo" ? 1.1 : 0.8)) * (type === "astronaut" ? 0.08 : 0.05);
      if (type === "astronaut") {
        model.rotation.z = baseRotation.z + Math.sin(time * 0.7) * 0.06;
      }
      renderer.render(scene, camera);
      requestAnimationFrame(renderObject);
    }

    renderObject();
  });
}
