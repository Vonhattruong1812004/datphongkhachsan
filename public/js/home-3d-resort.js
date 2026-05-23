import * as THREE from "/vendor/three.module.min.js";

const root = document.querySelector("[data-resort-3d]");

if (root && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const canvas = root.querySelector("canvas");
  const loading = root.querySelector("[data-resort-3d-loading]");
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xb8f1ff, 22, 66);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 120);
  camera.position.set(8.4, 6.25, 14.6);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;

  const clock = new THREE.Clock();
  const animated = [];
  const nightObjects = [];
  const dayObjects = [];
  const pointer = { x: 0, y: 0 };

  const mat = (color, roughness = 0.72, metalness = 0.02) => new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.035,
    roughness,
    metalness
  });

  const makeBox = (name, size, position, material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };

  const sun = new THREE.DirectionalLight(0xfff0bd, 4.2);
  sun.position.set(7, 10, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 36;
  scene.add(sun);
  dayObjects.push(sun);

  const moon = new THREE.DirectionalLight(0x9bbcff, 0);
  moon.position.set(-4, 8, -4);
  scene.add(moon);
  nightObjects.push(moon);

  const ambient = new THREE.HemisphereLight(0xe4fbff, 0x22715f, 2.4);
  scene.add(ambient);

  const skyShell = new THREE.Mesh(
    new THREE.SphereGeometry(34, 48, 24),
    new THREE.MeshBasicMaterial({ color: 0x8cf3ff, side: THREE.BackSide, transparent: true, opacity: 0.5 })
  );
  scene.add(skyShell);

  const flareGroup = new THREE.Group();
  const flareMaterial = new THREE.MeshBasicMaterial({
    color: 0xfff0a8,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  [1.2, 2.1, 3.2].forEach((radius, index) => {
    const flare = new THREE.Mesh(new THREE.RingGeometry(radius, radius + 0.035, 72), flareMaterial.clone());
    flare.position.set(4.6, 5.2, -6.7);
    flare.rotation.y = Math.PI / 2.8;
    flare.material.opacity = 0.18 - index * 0.04;
    flare.userData.baseOpacity = flare.material.opacity;
    flareGroup.add(flare);
  });
  scene.add(flareGroup);
  animated.push((time) => {
    flareGroup.rotation.z = time * 0.18;
    flareGroup.scale.setScalar(1 + Math.sin(time * 1.1) * 0.06);
  });

  const cloudMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.62 });
  const makeCloud = (x, y, z, scale = 1, speed = 1) => {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.scale.setScalar(scale);
    [0, 0.35, -0.38, 0.78].forEach((offset, index) => {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(index === 1 ? 0.34 : 0.26, 18, 12), cloudMaterial);
      puff.position.set(offset, index === 1 ? 0.08 : 0, 0);
      group.add(puff);
    });
    scene.add(group);
    animated.push((time) => {
      group.position.x = x + Math.sin(time * 0.22 * speed + z) * 1.25;
      group.position.y = y + Math.sin(time * 0.38 * speed + x) * 0.08;
    });
  };

  makeCloud(-4.6, 4.2, -5.6, 1.15, 1.1);
  makeCloud(3.9, 4.8, -6.8, 0.92, 0.8);
  makeCloud(0.6, 5.35, -8.2, 0.72, 1.4);

  const birdMaterial = new THREE.MeshBasicMaterial({ color: 0x14314b, transparent: true, opacity: 0.72 });
  const makeBird = (index) => {
    const group = new THREE.Group();
    const leftWing = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.025, 0.025), birdMaterial);
    const rightWing = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.025, 0.025), birdMaterial);
    leftWing.position.x = -0.16;
    rightWing.position.x = 0.16;
    group.add(leftWing, rightWing);
    scene.add(group);
    animated.push((time) => {
      const progress = ((time * (0.12 + index * 0.018) + index * 0.23) % 1);
      group.position.set(-6.2 + progress * 12.4, 4.15 + Math.sin(time * 1.8 + index) * 0.18, -4.2 - index * 0.58);
      group.rotation.y = -0.18;
      leftWing.rotation.z = 0.38 + Math.sin(time * 8 + index) * 0.22;
      rightWing.rotation.z = -0.38 - Math.sin(time * 8 + index) * 0.22;
    });
  };

  for (let index = 0; index < 5; index += 1) {
    makeBird(index);
  }

  const particleCount = 92;
  const particleGeometry = new THREE.BufferGeometry();
  const particlePositions = new Float32Array(particleCount * 3);
  for (let index = 0; index < particleCount; index += 1) {
    particlePositions[index * 3] = (Math.random() - 0.5) * 12;
    particlePositions[index * 3 + 1] = 0.8 + Math.random() * 5.2;
    particlePositions[index * 3 + 2] = -6 + Math.random() * 9;
  }
  particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
  const particles = new THREE.Points(
    particleGeometry,
    new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.065,
      transparent: true,
      opacity: 0.62,
      depthWrite: false
    })
  );
  scene.add(particles);
  animated.push((time) => {
    particles.rotation.y = time * 0.045;
    particles.position.y = Math.sin(time * 0.7) * 0.16;
    particles.material.opacity = 0.46 + Math.sin(time * 1.8) * 0.18;
  });

  const beach = new THREE.Mesh(
    new THREE.CylinderGeometry(5.25, 5.8, 0.55, 96),
    mat(0xffc95a, 0.76)
  );
  beach.scale.z = 0.66;
  beach.position.set(0, -0.18, 0);
  beach.receiveShadow = true;
  scene.add(beach);

  const grass = new THREE.Mesh(
    new THREE.CylinderGeometry(4.0, 4.45, 0.38, 96),
    mat(0x1ead58, 0.74)
  );
  grass.scale.z = 0.52;
  grass.position.set(-0.2, 0.13, -0.25);
  grass.receiveShadow = true;
  scene.add(grass);

  const waterGeometry = new THREE.PlaneGeometry(36, 28, 96, 72);
  const water = new THREE.Mesh(
    waterGeometry,
    new THREE.MeshStandardMaterial({
      color: 0x079fca,
      roughness: 0.22,
      metalness: 0.26,
      transparent: true,
      opacity: 0.9,
      emissive: 0x032f4a,
      emissiveIntensity: 0.055
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.5;
  water.position.z = 1.4;
  water.receiveShadow = true;
  scene.add(water);

  const waterPositions = waterGeometry.attributes.position;
  const baseWaterY = Array.from({ length: waterPositions.count }, (_, index) => waterPositions.getZ(index));
  animated.push((time) => {
    for (let index = 0; index < waterPositions.count; index += 1) {
      const x = waterPositions.getX(index);
      const y = waterPositions.getY(index);
      const wave = Math.sin(x * 0.72 + time * 2.35) * 0.14
        + Math.cos(y * 0.58 + time * 1.75) * 0.08
        + Math.sin((x + y) * 0.32 + time * 2.9) * 0.035;
      waterPositions.setZ(index, baseWaterY[index] + wave);
    }
    waterPositions.needsUpdate = true;
    water.rotation.z = Math.sin(time * 0.22) * 0.035;
  });

  const foamMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.54,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const foamRings = [];
  [
    [-2.7, 2.25, 0.85],
    [2.55, 2.0, 0.72],
    [0.1, 3.25, 1.05],
    [-3.8, 0.4, 0.58]
  ].forEach(([x, z, radius], index) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.018, 8, 80), foamMaterial.clone());
    ring.position.set(x, -0.34, z);
    ring.rotation.x = Math.PI / 2;
    ring.material.opacity = 0.28 + index * 0.05;
    scene.add(ring);
    foamRings.push(ring);
  });
  animated.push((time) => {
    foamRings.forEach((ring, index) => {
      const pulse = 1 + ((time * (0.22 + index * 0.03) + index * 0.2) % 1) * 0.34;
      ring.scale.set(pulse, pulse, pulse);
      ring.material.opacity = 0.5 - (pulse - 1) * 0.95;
      ring.rotation.z = time * (0.12 + index * 0.03);
    });
  });

  const foamStreakMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const foamStreaks = [];
  for (let index = 0; index < 12; index += 1) {
    const streak = new THREE.Mesh(new THREE.PlaneGeometry(1.4 + (index % 4) * 0.36, 0.045), foamStreakMaterial.clone());
    streak.rotation.x = -Math.PI / 2;
    streak.rotation.z = (index % 3) * 0.08;
    streak.position.set(-5 + (index % 6) * 1.65, -0.28, 0.65 + Math.floor(index / 6) * 1.55);
    scene.add(streak);
    foamStreaks.push(streak);
  }
  animated.push((time) => {
    foamStreaks.forEach((streak, index) => {
      const lane = Math.floor(index / 6);
      const progress = (time * (0.42 + lane * 0.16) + index * 0.17) % 1;
      streak.position.x = -5.4 + progress * 10.8;
      streak.position.z = 0.64 + lane * 1.6 + Math.sin(time * 1.3 + index) * 0.12;
      streak.material.opacity = 0.18 + Math.sin(progress * Math.PI) * 0.45;
    });
  });

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xbcecff,
    roughness: 0.18,
    metalness: 0.05,
    transmission: 0.12,
    transparent: true,
    opacity: 0.72
  });
  const wall = mat(0xffdf94, 0.66);
  const roof = mat(0xa94a17, 0.72);
  const wood = mat(0x6f3b16, 0.76);

  const lobby = makeBox("lobby", [2.1, 1.15, 1.15], [-0.45, 0.96, -0.38], wall);
  const towerA = makeBox("tower-a", [1.1, 1.95, 1.05], [-1.75, 1.36, -0.52], wall);
  const towerB = makeBox("tower-b", [1.02, 1.62, 1.02], [0.95, 1.18, -0.5], wall);
  makeBox("lobby-roof", [2.34, 0.18, 1.32], [-0.45, 1.64, -0.38], roof);
  makeBox("tower-a-roof", [1.28, 0.18, 1.2], [-1.75, 2.45, -0.52], roof);
  makeBox("tower-b-roof", [1.18, 0.18, 1.14], [0.95, 2.03, -0.5], roof);

  [lobby, towerA, towerB].forEach((building) => {
    const width = building.geometry.parameters.width;
    for (let floor = 0; floor < 3; floor += 1) {
      for (let col = -1; col <= 1; col += 1) {
        if (Math.abs(col) * 0.42 > width / 2) continue;
        const windowPane = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.035), glass);
        windowPane.position.set(
          building.position.x + col * 0.38,
          building.position.y - 0.36 + floor * 0.42,
          building.position.z + 0.535
        );
        windowPane.castShadow = false;
        scene.add(windowPane);
      }
    }
  });

  const pool = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.08, 1.05),
    new THREE.MeshStandardMaterial({ color: 0x39f2ff, roughness: 0.12, metalness: 0.12, transparent: true, opacity: 0.88, emissive: 0x00a7c7, emissiveIntensity: 0.16 })
  );
  pool.position.set(1.12, 0.45, 1.03);
  pool.receiveShadow = true;
  scene.add(pool);
  animated.push((time) => {
    pool.scale.x = 1 + Math.sin(time * 2.2) * 0.012;
    pool.scale.z = 1 + Math.cos(time * 2.4) * 0.018;
    pool.material.opacity = 0.78 + Math.sin(time * 2.1) * 0.08;
  });

  const deck = makeBox("deck", [3.05, 0.08, 1.45], [0.78, 0.36, 1.03], mat(0xd8a05d, 0.8));
  deck.receiveShadow = true;
  pool.position.y = 0.44;

  for (let i = 0; i < 7; i += 1) {
    const chair = makeBox("sun-chair", [0.42, 0.08, 0.82], [-2.55 + i * 0.42, 0.48, 1.72], mat(0xffffff, 0.58));
    chair.rotation.y = -0.16;
  }

  const makePalm = (x, z, scale = 1, lean = 0) => {
    const group = new THREE.Group();
    group.position.set(x, 0.2, z);
    group.scale.setScalar(scale);
    group.rotation.z = lean;

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 1.4, 10), wood);
    trunk.position.y = 0.7;
    trunk.castShadow = true;
    group.add(trunk);

    const leafMaterial = mat(0x118a51, 0.78);
    for (let index = 0; index < 7; index += 1) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.95, 8), leafMaterial);
      leaf.position.y = 1.46;
      leaf.rotation.z = Math.PI / 2;
      leaf.rotation.y = (Math.PI * 2 * index) / 7;
      leaf.position.x = Math.cos(leaf.rotation.y) * 0.32;
      leaf.position.z = Math.sin(leaf.rotation.y) * 0.32;
      leaf.castShadow = true;
      group.add(leaf);
    }

    const coconutMaterial = mat(0x5a2f13, 0.82);
    for (let index = 0; index < 3; index += 1) {
      const coconut = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), coconutMaterial);
      coconut.position.set(Math.cos(index * 2.1) * 0.09, 1.32, Math.sin(index * 2.1) * 0.09);
      coconut.castShadow = true;
      group.add(coconut);
    }

    scene.add(group);
    animated.push((time) => {
      group.rotation.z = lean + Math.sin(time * 1.65 + x) * 0.075;
      group.position.y = 0.2 + Math.sin(time * 1.2 + z) * 0.018;
    });
  };

  makePalm(-3.2, 0.6, 1.05, -0.12);
  makePalm(2.9, 0.4, 0.92, 0.14);
  makePalm(-2.5, -1.55, 0.82, -0.08);
  makePalm(3.45, -1.35, 0.78, 0.1);
  makePalm(-3.75, 1.7, 0.72, -0.16);
  makePalm(1.85, -2.1, 0.66, 0.12);

  const flowerStemMaterial = mat(0x127a43, 0.78);
  const grassBladeMaterial = mat(0x0e7a45, 0.84);
  const flowerMaterials = [0xff3d7f, 0xffc928, 0x8f4dff, 0xff6b3d, 0xffffff].map((color) => mat(color, 0.64));
  const flowerPetalGeometry = new THREE.SphereGeometry(0.055, 10, 8);
  const flowerCenterGeometry = new THREE.SphereGeometry(0.032, 10, 8);
  const grassBladeGeometry = new THREE.ConeGeometry(0.025, 0.28, 5);

  const makeFlower = (x, z, scale = 1, colorIndex = 0) => {
    const group = new THREE.Group();
    group.position.set(x, 0.33, z);
    group.scale.setScalar(scale);

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.2, 6), flowerStemMaterial);
    stem.position.y = 0.1;
    stem.castShadow = true;
    group.add(stem);

    for (let index = 0; index < 5; index += 1) {
      const petal = new THREE.Mesh(flowerPetalGeometry, flowerMaterials[(colorIndex + index) % flowerMaterials.length]);
      petal.position.set(Math.cos((Math.PI * 2 * index) / 5) * 0.055, 0.22, Math.sin((Math.PI * 2 * index) / 5) * 0.055);
      petal.scale.set(1.15, 0.62, 1.15);
      petal.castShadow = true;
      group.add(petal);
    }

    const center = new THREE.Mesh(flowerCenterGeometry, mat(0x5a2f13, 0.72));
    center.position.y = 0.22;
    group.add(center);
    scene.add(group);
    animated.push((time) => {
      group.rotation.y = Math.sin(time * 0.75 + x * 0.4) * 0.08;
      group.position.y = 0.33 + Math.sin(time * 1.5 + z) * 0.01;
    });
  };

  const makeGrassTuft = (x, z, scale = 1) => {
    const group = new THREE.Group();
    group.position.set(x, 0.29, z);
    group.scale.setScalar(scale);
    for (let index = 0; index < 5; index += 1) {
      const blade = new THREE.Mesh(grassBladeGeometry, grassBladeMaterial);
      blade.position.set((index - 2) * 0.035, 0.12, Math.sin(index) * 0.035);
      blade.rotation.z = (index - 2) * 0.18;
      blade.castShadow = true;
      group.add(blade);
    }
    scene.add(group);
    animated.push((time) => {
      group.rotation.z = Math.sin(time * 1.35 + x) * 0.035;
    });
  };

  for (let index = 0; index < 46; index += 1) {
    const angle = index * 2.399;
    const radius = 1.7 + (index % 7) * 0.42;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius * 0.58 - 0.18;
    if (Math.abs(x) < 1.95 && z > -0.95 && z < 1.45) continue;
    makeFlower(x, z, 0.68 + (index % 4) * 0.08, index);
  }

  for (let index = 0; index < 34; index += 1) {
    const angle = index * 1.618;
    const radius = 1.1 + (index % 8) * 0.45;
    const x = Math.cos(angle) * radius * 0.95;
    const z = Math.sin(angle) * radius * 0.52 - 0.2;
    if (Math.abs(x) < 1.55 && z > -0.75 && z < 1.3) continue;
    makeGrassTuft(x, z, 0.72 + (index % 5) * 0.07);
  }

  const pier = makeBox("pier", [0.44, 0.12, 3.2], [2.85, 0.14, 2.25], wood);
  pier.rotation.y = -0.18;
  for (let i = 0; i < 5; i += 1) {
    makeBox("pier-post", [0.08, 0.52, 0.08], [2.35 + i * 0.24, -0.02, 1.08 + i * 0.44], wood);
  }

  const boat = new THREE.Group();
  boat.position.set(-3.2, -0.04, 2.8);
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.2, 0.32), mat(0x9b4c23, 0.72));
  hull.castShadow = true;
  boat.add(hull);
  const sail = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.86, 3), mat(0xffffff, 0.5));
  sail.position.set(0.12, 0.52, 0);
  sail.rotation.z = -0.25;
  sail.castShadow = true;
  boat.add(sail);
  scene.add(boat);
  animated.push((time) => {
    boat.position.x = -3.15 + Math.sin(time * 0.58) * 1.65;
    boat.position.z = 2.78 + Math.cos(time * 0.42) * 0.36;
    boat.position.y = -0.03 + Math.sin(time * 2.2) * 0.085;
    boat.rotation.z = Math.sin(time * 1.75) * 0.085;
    boat.rotation.y = Math.sin(time * 0.58) * 0.18;
  });

  const animalMaterial = new THREE.MeshStandardMaterial({
    color: 0x195673,
    emissive: 0x061f2e,
    emissiveIntensity: 0.08,
    roughness: 0.52,
    metalness: 0.04
  });
  const animalBellyMaterial = new THREE.MeshStandardMaterial({
    color: 0xc8f3ff,
    emissive: 0x23566a,
    emissiveIntensity: 0.04,
    roughness: 0.58,
    metalness: 0.02
  });

  const makeDolphin = (x, z, scale = 1, phase = 0) => {
    const group = new THREE.Group();
    group.position.set(x, -0.12, z);
    group.scale.setScalar(scale);
    group.rotation.y = -0.12;

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 14), animalMaterial);
    body.scale.set(1.45, 0.38, 0.5);
    body.castShadow = true;
    group.add(body);

    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 10), animalBellyMaterial);
    snout.position.set(0.54, -0.02, 0);
    snout.scale.set(1.35, 0.52, 0.48);
    group.add(snout);

    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 10), animalBellyMaterial);
    belly.position.set(0.08, -0.12, 0);
    belly.scale.set(1.55, 0.22, 0.52);
    group.add(belly);

    const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 3), animalMaterial);
    dorsal.position.set(-0.1, 0.24, 0);
    dorsal.rotation.z = -0.22;
    group.add(dorsal);

    const tailLeft = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.36, 3), animalMaterial);
    tailLeft.position.set(-0.66, 0.04, -0.12);
    tailLeft.rotation.z = Math.PI / 2;
    tailLeft.rotation.y = -0.54;
    group.add(tailLeft);

    const tailRight = tailLeft.clone();
    tailRight.position.z = 0.12;
    tailRight.rotation.y = 0.54;
    group.add(tailRight);

    scene.add(group);
    animated.push((time) => {
      const jump = Math.max(0, Math.sin(time * 1.35 + phase));
      group.position.x = x + Math.sin(time * 0.38 + phase) * 0.78;
      group.position.z = z + Math.cos(time * 0.34 + phase) * 0.28;
      group.position.y = -0.18 + jump * 0.52;
      group.rotation.z = -0.2 + jump * 0.5;
      tailLeft.rotation.x = Math.sin(time * 7 + phase) * 0.22;
      tailRight.rotation.x = -Math.sin(time * 7 + phase) * 0.22;
    });
  };

  const makeWhale = (x, z, scale = 1, phase = 0) => {
    const group = new THREE.Group();
    group.position.set(x, -0.28, z);
    group.scale.setScalar(scale);
    group.rotation.y = -0.24;

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.54, 30, 16), animalMaterial);
    body.scale.set(1.9, 0.55, 0.72);
    body.castShadow = true;
    group.add(body);

    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.38, 18, 10), animalBellyMaterial);
    belly.position.set(0.18, -0.2, 0);
    belly.scale.set(1.9, 0.22, 0.68);
    group.add(belly);

    const tail = new THREE.Group();
    tail.position.set(-1.02, 0.08, 0);
    const finA = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 3), animalMaterial);
    finA.rotation.z = Math.PI / 2;
    finA.rotation.y = -0.7;
    const finB = finA.clone();
    finB.rotation.y = 0.7;
    tail.add(finA, finB);
    group.add(tail);

    const spoutMaterial = new THREE.MeshBasicMaterial({
      color: 0xe8fbff,
      transparent: true,
      opacity: 0.4,
      depthWrite: false
    });
    const spout = new THREE.Group();
    for (let index = 0; index < 4; index += 1) {
      const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.026, 0.58 + index * 0.08, 6), spoutMaterial.clone());
      jet.position.set((index - 1.5) * 0.04, 0.6 + index * 0.08, Math.sin(index) * 0.035);
      jet.rotation.z = (index - 1.5) * 0.12;
      spout.add(jet);
    }
    spout.position.set(0.16, 0.14, 0);
    group.add(spout);

    scene.add(group);
    animated.push((time) => {
      group.position.x = x + Math.sin(time * 0.2 + phase) * 0.42;
      group.position.z = z + Math.cos(time * 0.22 + phase) * 0.2;
      group.position.y = -0.31 + Math.sin(time * 1.1 + phase) * 0.04;
      tail.rotation.y = Math.sin(time * 2.2 + phase) * 0.22;
      spout.children.forEach((jet, index) => {
        jet.material.opacity = 0.16 + Math.max(0, Math.sin(time * 1.4 + phase + index * 0.35)) * 0.36;
        jet.scale.y = 0.75 + Math.max(0, Math.sin(time * 1.4 + phase + index * 0.35)) * 0.42;
      });
    });
  };

  makeDolphin(-2.8, 3.65, 0.72, 0.4);
  makeDolphin(1.9, 3.95, 0.58, 1.8);
  makeWhale(4.1, 4.45, 0.78, 0.9);

  const sunOrb = new THREE.Mesh(
    new THREE.SphereGeometry(0.58, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0xffd25d })
  );
  sunOrb.position.set(4.6, 5.2, -6.8);
  scene.add(sunOrb);
  dayObjects.push(sunOrb);

  const moonOrb = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0xdbeafe, transparent: true, opacity: 0 })
  );
  moonOrb.position.set(-4.4, 5.1, -6.3);
  scene.add(moonOrb);
  nightObjects.push(moonOrb);

  const moonGlow = new THREE.Mesh(
    new THREE.RingGeometry(0.52, 0.88, 72),
    new THREE.MeshBasicMaterial({
      color: 0xbdd7ff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  );
  moonGlow.position.copy(moonOrb.position);
  moonGlow.rotation.y = Math.PI / 2.8;
  scene.add(moonGlow);

  const moonCraterMaterial = new THREE.MeshBasicMaterial({ color: 0x9eb8d8, transparent: true, opacity: 0 });
  const moonCraters = [];
  [
    [-0.1, 0.08, 0.045],
    [0.09, -0.06, 0.035],
    [0.12, 0.13, 0.028]
  ].forEach(([x, y, radius]) => {
    const crater = new THREE.Mesh(new THREE.CircleGeometry(radius, 16), moonCraterMaterial.clone());
    crater.userData.offset = { x, y };
    crater.position.set(moonOrb.position.x + x, moonOrb.position.y + y, moonOrb.position.z + 0.41);
    scene.add(crater);
    moonCraters.push(crater);
    nightObjects.push(crater);
  });

  const resortLights = [];
  for (let index = 0; index < 10; index += 1) {
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe6a3, transparent: true, opacity: 0 })
    );
    light.position.set(-2.1 + index * 0.42, 1.1 + (index % 3) * 0.42, 0.08);
    scene.add(light);
    resortLights.push(light);
    nightObjects.push(light);
  }

  root.addEventListener("pointermove", (event) => {
    const rect = root.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    pointer.y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
  }, { passive: true });

  root.addEventListener("pointerleave", () => {
    pointer.x = 0;
    pointer.y = 0;
  }, { passive: true });

  const setTheme = (theme) => {
    const night = theme === "night";
    scene.fog.color.set(night ? 0x04132c : 0xb8f1ff);
    ambient.intensity = night ? 0.72 : 2.55;
    sun.intensity = night ? 0 : 4.4;
    moon.intensity = night ? 2.15 : 0;
    renderer.setClearColor(night ? 0x04132c : 0xb8f1ff, 0);
    water.material.color.set(night ? 0x0a4969 : 0x079fca);
    skyShell.material.color.set(night ? 0x041128 : 0x7ae8ff);
    skyShell.material.opacity = night ? 0.42 : 0.56;
    sunOrb.material.opacity = night ? 0 : 1;
    sunOrb.material.transparent = true;
    moonOrb.material.opacity = night ? 0.92 : 0;
    moonGlow.material.opacity = night ? 0.32 : 0;
    flareGroup.children.forEach((flare) => {
      flare.material.opacity = night ? 0.02 : flare.userData.baseOpacity;
    });
    nightObjects.forEach((item) => {
      if (item === moonOrb) return;
      if (!item.material) return;
      item.material.opacity = night ? 0.92 : 0;
    });
    resortLights.forEach((item) => {
      item.material.opacity = night ? 0.92 : 0;
    });
  };

  const resize = () => {
    const rect = root.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(420, Math.floor(rect.height));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };

  const render = () => {
    const time = clock.getElapsedTime();
    animated.forEach((fn) => fn(time));
    const orbit = time * 0.28;
    camera.position.x = 8.3 + Math.sin(orbit) * 2.65 + pointer.x * 0.9;
    camera.position.z = 14.2 + Math.cos(orbit) * 1.9;
    camera.position.y = 6.2 + Math.sin(time * 0.62) * 0.44 - pointer.y * 0.38;
    sun.position.x = 6.6 + Math.sin(time * 0.22) * 1.4;
    sun.position.z = 5.8 + Math.cos(time * 0.22) * 1.2;
    sunOrb.position.y = 5.2 + Math.sin(time * 0.34) * 0.24;
    moonOrb.position.y = 5.1 + Math.sin(time * 0.28) * 0.2;
    moonGlow.position.y = moonOrb.position.y;
    moonCraters.forEach((crater) => {
      crater.position.y = moonOrb.position.y + crater.userData.offset.y;
    });
    flareGroup.position.x = pointer.x * 0.08;
    flareGroup.position.y = -pointer.y * 0.06;
    camera.lookAt(0, 0.9, 0.35);
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  };

  const observer = new MutationObserver(() => {
    setTheme(document.getElementById("travel-home")?.dataset.theme === "night" ? "night" : "day");
  });
  const home = document.getElementById("travel-home");
  if (home) observer.observe(home, { attributes: true, attributeFilter: ["data-theme"] });

  window.addEventListener("resize", resize, { passive: true });
  resize();
  setTheme(home?.dataset.theme === "night" ? "night" : "day");
  loading?.remove();
  render();
}
