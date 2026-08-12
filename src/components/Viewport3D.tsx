import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { LinearParams, LightingPreset } from '../engine/types';
import { MATERIALS, BIT_SIZE_IN, CARVE_DEPTH_IN } from '../engine/types';
import type { LinearPattern } from '../engine/geometry';
import {
  generateHeightField,
  generateReliefHeightField,
  combineHeightFields,
  burnPanelSeams,
  generateNormalMapFromField,
} from '../engine/textures';

interface Viewport3DProps {
  params: LinearParams;
  pattern: LinearPattern;
  lightingPreset: LightingPreset;
  bgColor: string;
  floorEnabled: boolean;
  scaleFigureEnabled: boolean;
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>;
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>;
}

interface LightConfig {
  hemi: { sky: number; ground: number; intensity: number };
  dirs: {
    color: number;
    intensity: number;
    // position as multiples of wall span [x, y, z]
    pos: [number, number, number];
    shadow?: boolean;
  }[];
}

const LIGHTING: Record<LightingPreset, LightConfig> = {
  studio: {
    hemi: { sky: 0xfff8ee, ground: 0x33302a, intensity: 0.45 },
    dirs: [
      { color: 0xfff4e2, intensity: 1.5, pos: [0.6, 1.1, 0.55], shadow: true },
      { color: 0xffffff, intensity: 0.5, pos: [-0.85, 0.55, 0.2] },
      { color: 0xf2ecff, intensity: 0.25, pos: [0.15, 0.2, 0.9] },
    ],
  },
  gallery: {
    hemi: { sky: 0xffffff, ground: 0x4a463f, intensity: 0.75 },
    dirs: [
      { color: 0xffffff, intensity: 1.0, pos: [0.25, 1.3, 0.7], shadow: true },
      { color: 0xffffff, intensity: 0.45, pos: [-0.4, 0.6, 0.6] },
    ],
  },
  raking: {
    hemi: { sky: 0xfff4e0, ground: 0x2a2722, intensity: 0.2 },
    dirs: [
      { color: 0xffe8c4, intensity: 1.9, pos: [-1.1, 0.6, 0.18], shadow: true },
      { color: 0xffffff, intensity: 0.3, pos: [0.5, 0.5, 0.7] },
    ],
  },
};

export default function Viewport3D({
  params,
  pattern,
  lightingPreset,
  bgColor,
  floorEnabled,
  scaleFigureEnabled,
  rendererRef,
  sceneRef,
  cameraRef,
}: Viewport3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const panelGroupRef = useRef<THREE.Group | null>(null);
  const lightsRef = useRef<THREE.Light[]>([]);
  const floorRef = useRef<THREE.Mesh | null>(null);
  const figureRef = useRef<THREE.Group | null>(null);
  const animFrameRef = useRef(0);
  const initializedRef = useRef(false);
  const fittedDimsRef = useRef<{ w: number; h: number } | null>(null);
  const patternRef = useRef(pattern);
  patternRef.current = pattern;

  const fitCamera = () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const { wallW, wallH } = patternRef.current;
    fittedDimsRef.current = { w: wallW, h: wallH };
    const fovRad = (camera.fov * Math.PI) / 180;
    const aspect = camera.aspect || 1.6;
    const fitH = wallH / 2 / Math.tan(fovRad / 2);
    const fitW = wallW / 2 / (Math.tan(fovRad / 2) * aspect);
    const dist = Math.max(fitH, fitW) * 1.25;
    const centerY = wallH / 2;
    camera.position.set(wallW * 0.12, centerY + wallH * 0.08, dist);
    controls.target.set(0, centerY, 0);
    controls.update();
  };

  // ── Scene init (once) ──
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    const container = containerRef.current;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      600
    );
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.rotateSpeed = 0.7;
    controls.zoomSpeed = 0.9;
    controls.minDistance = 1.5;
    controls.maxDistance = 250;
    controls.maxPolarAngle = Math.PI * 0.93;
    controlsRef.current = controls;

    const panelGroup = new THREE.Group();
    scene.add(panelGroup);
    panelGroupRef.current = panelGroup;

    // Floor — shadow catcher only, so it reads on any background color
    const floorGeo = new THREE.CircleGeometry(120, 64);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.3 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    scene.add(floor);
    floorRef.current = floor;

    // Scale figure — simple 6ft silhouette for a sense of size
    const figure = new THREE.Group();
    const figMat = new THREE.MeshStandardMaterial({ color: 0x2e2c29, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 3.6, 6, 14), figMat);
    body.position.y = 2.6;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14), figMat);
    head.position.y = 5.5;
    head.castShadow = true;
    figure.add(body, head);
    scene.add(figure);
    figureRef.current = figure;

    fitCamera();

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth, h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      initializedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Background color ──
  useEffect(() => {
    const scene = sceneRef.current;
    if (scene) scene.background = new THREE.Color(bgColor);
  }, [bgColor, sceneRef]);

  // ── Floor + scale figure visibility ──
  useEffect(() => {
    if (floorRef.current) floorRef.current.visible = floorEnabled;
  }, [floorEnabled]);
  useEffect(() => {
    if (figureRef.current) figureRef.current.visible = scaleFigureEnabled;
  }, [scaleFigureEnabled]);

  // ── Lighting ──
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    for (const l of lightsRef.current) scene.remove(l);
    lightsRef.current = [];

    const span = Math.max(pattern.wallW, pattern.wallH);
    const cfg = LIGHTING[lightingPreset];

    const hemi = new THREE.HemisphereLight(cfg.hemi.sky, cfg.hemi.ground, cfg.hemi.intensity);
    scene.add(hemi);
    lightsRef.current.push(hemi);

    for (const d of cfg.dirs) {
      const light = new THREE.DirectionalLight(d.color, d.intensity);
      light.position.set(d.pos[0] * span, Math.max(2, d.pos[1] * span), d.pos[2] * span);
      light.target.position.set(0, pattern.wallH / 2, 0);
      scene.add(light.target);
      if (d.shadow) {
        light.castShadow = true;
        light.shadow.mapSize.set(2048, 2048);
        light.shadow.bias = -0.0004;
        const bound = span * 0.85;
        light.shadow.camera.left = -bound;
        light.shadow.camera.right = bound;
        light.shadow.camera.top = bound;
        light.shadow.camera.bottom = -bound;
        light.shadow.camera.near = 0.1;
        light.shadow.camera.far = span * 4;
      }
      scene.add(light);
      lightsRef.current.push(light);
    }
  }, [lightingPreset, pattern.wallW, pattern.wallH, sceneRef]);

  // ── Panel meshes + carve textures ──
  useEffect(() => {
    const panelGroup = panelGroupRef.current;
    const renderer = rendererRef.current;
    if (!panelGroup || !renderer) return;

    // Cleanup previous build
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    panelGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const mat = child.material as THREE.MeshStandardMaterial;
        materials.add(mat);
        if (mat.displacementMap) textures.add(mat.displacementMap);
        if (mat.normalMap) textures.add(mat.normalMap);
      }
    });
    for (const t of textures) t.dispose();
    for (const m of materials) m.dispose();
    panelGroup.clear();

    const { edges, panels, wallW, wallH, relief } = pattern;
    if (edges.length === 0 && !relief) return;

    const bitDiamFt = BIT_SIZE_IN[params.bitSize] / 12;
    const carveDepthIn = CARVE_DEPTH_IN[params.carveDepth];
    const carveDepthFt = carveDepthIn / 12;

    // Displacement map — aspect-matched, max 4096 on longest side
    const longestSide = Math.max(wallW, wallH);
    const pxPerFt = Math.min(400, 4096 / longestSide);
    const resW = Math.round(wallW * pxPerFt);
    const resH = Math.round(wallH * pxPerFt);

    let heightField = generateHeightField(
      edges, wallW, wallH, bitDiamFt / 2, carveDepthFt, params.bitProfile, resW, resH
    );
    if (relief) {
      const reliefField = generateReliefHeightField(relief, wallW, wallH, carveDepthFt, resW, resH);
      heightField = edges.length > 0 ? combineHeightFields(heightField, reliefField) : reliefField;
    }
    burnPanelSeams(heightField, resW, resH, panels, wallW, wallH, carveDepthFt * 0.35);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    // Float displacement texture — full precision, no 8-bit contour banding
    // on smooth relief slopes. Rows flipped: field row 0 is the wall top,
    // texture row 0 is v=0 (wall bottom).
    const dispData = new Float32Array(resW * resH);
    const invD = 1 / carveDepthFt;
    for (let y = 0; y < resH; y++) {
      const src = y * resW;
      const dst = (resH - 1 - y) * resW;
      for (let x = 0; x < resW; x++) {
        const norm = heightField[src + x] * invD;
        dispData[dst + x] = 1 - (norm > 1 ? 1 : norm);
      }
    }
    const dispTexture = new THREE.DataTexture(dispData, resW, resH, THREE.RedFormat, THREE.FloatType);
    dispTexture.wrapS = THREE.ClampToEdgeWrapping;
    dispTexture.wrapT = THREE.ClampToEdgeWrapping;
    dispTexture.minFilter = THREE.LinearFilter;
    dispTexture.magFilter = THREE.LinearFilter;
    dispTexture.needsUpdate = true;

    // Normal map strength scales with carve depth so depth reads visually;
    // relief slopes are far gentler than groove walls, so boost them.
    const isReliefOnly = !!relief && edges.length === 0;
    const normalStrength = (4 + (carveDepthIn / 0.375) * 8) * (isReliefOnly ? 3.5 : 1);
    const normCanvas = generateNormalMapFromField(heightField, resW, resH, carveDepthFt, normalStrength);

    const normTexture = new THREE.CanvasTexture(normCanvas);
    normTexture.wrapS = THREE.ClampToEdgeWrapping;
    normTexture.wrapT = THREE.ClampToEdgeWrapping;
    normTexture.generateMipmaps = true;
    normTexture.minFilter = THREE.LinearMipmapLinearFilter;
    normTexture.magFilter = THREE.LinearFilter;
    normTexture.anisotropy = maxAniso;

    const matPreset = MATERIALS[params.material] ?? MATERIALS['White Oak'];

    // Exaggerate displacement so carve depth is clearly visible in the 3D
    // view — more for continuous relief, whose gentle slopes read weakly at
    // wall scale. (DXF and STL exports remain dimensionally accurate.)
    const isRelief = !!relief && edges.length === 0;
    const dispScale = carveDepthFt * (isRelief ? 6 : 3);
    const nmScale = (0.8 + (carveDepthIn / 0.375) * 1.2) * (isRelief ? 2 : 1);

    const panelMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(matPreset.color),
      roughness: matPreset.roughness,
      metalness: matPreset.metalness,
      displacementMap: dispTexture,
      displacementScale: dispScale,
      displacementBias: -dispScale,
      normalMap: normTexture,
      normalScale: new THREE.Vector2(nmScale, nmScale),
    });

    // Dynamic segment count — ~800K vertex budget across all panels
    const vertsPerPanel = 800000 / panels.length;
    const segsPerUnit = Math.min(128, Math.max(24, Math.floor(Math.sqrt(vertsPerPanel) / 2)));

    for (const p of panels) {
      const segX = Math.max(16, Math.round((segsPerUnit * p.w) / 2));
      const segY = Math.max(16, Math.round((segsPerUnit * p.h) / 2));
      const planeGeo = new THREE.PlaneGeometry(p.w, p.h, segX, segY);

      // Remap UVs so each panel samples its region of the full-wall texture
      const uvAttr = planeGeo.getAttribute('uv') as THREE.BufferAttribute;
      const uMin = (p.gx * 2) / wallW;
      const uMax = (p.gx * 2 + p.w) / wallW;
      const vMin = (p.gy * 2) / wallH;
      const vMax = (p.gy * 2 + p.h) / wallH;
      for (let i = 0; i < uvAttr.count; i++) {
        uvAttr.setXY(
          i,
          uMin + uvAttr.getX(i) * (uMax - uMin),
          vMin + uvAttr.getY(i) * (vMax - vMin)
        );
      }
      uvAttr.needsUpdate = true;

      const mesh = new THREE.Mesh(planeGeo, panelMat);
      // Wall bottom sits on the floor (y=0)
      mesh.position.x = p.gx * 2 + p.w / 2 - wallW / 2;
      mesh.position.y = p.gy * 2 + p.h / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      panelGroup.add(mesh);
    }

    // Backing slab behind the whole wall
    const backingThickness = 0.0625; // 3/4" in feet
    const backGeo = new THREE.BoxGeometry(wallW, wallH, backingThickness);
    const backMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(matPreset.color).multiplyScalar(0.82),
      roughness: Math.min(1, matPreset.roughness + 0.1),
      metalness: matPreset.metalness,
    });
    const backMesh = new THREE.Mesh(backGeo, backMat);
    backMesh.position.y = wallH / 2;
    backMesh.position.z = -(backingThickness / 2 + dispScale * 0.5);
    backMesh.castShadow = true;
    backMesh.receiveShadow = true;
    panelGroup.add(backMesh);

    // Move the scale figure just right of the wall
    if (figureRef.current) {
      figureRef.current.position.set(wallW / 2 + 2.2, 0, 1.2);
    }
  }, [pattern, params.bitSize, params.bitProfile, params.carveDepth, params.material, rendererRef]);

  // ── Camera refit whenever wall dimensions change ──
  useEffect(() => {
    const prev = fittedDimsRef.current;
    if (prev && prev.w === pattern.wallW && prev.h === pattern.wallH) return;
    fitCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern.wallW, pattern.wallH]);

  return <div ref={containerRef} className="flex-1 h-screen min-w-0" />;
}
