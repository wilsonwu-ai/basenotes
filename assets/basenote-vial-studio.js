/**
 * Base Note's interactive, reference-derived 5 ml glass atomizer.
 * Built from the Union Made studio lighting/renderer pattern, with custom vial
 * geometry and touch gestures that preserve normal vertical page scrolling.
 * Bundle locally; see docs/design/vial-reference.md. Three.js is MIT licensed.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const PALETTE = { background: '#eee9dd', paper: '#faf7ee', ink: '#22392b', liquid: '#e5cda0' };
const REST = { yaw: -0.19, pitch: 0.075, distance: 8.85, targetY: 0, open: 0 };

/** Wrap human-readable product names without shrinking long labels into noise. */
function wrapLabel(context, value, maxWidth, maxLines = 3) {
  const words = String(value || '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

function labelTexture(product) {
  const canvas = document.createElement('canvas');
  canvas.width = 1536;
  canvas.height = 768;
  const context = canvas.getContext('2d');
  context.fillStyle = PALETTE.paper;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = PALETTE.ink;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const vendor = product.vendor || 'Base Note';
  const escapedVendor = vendor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const title = (product.title || 'Your next scent').replace(new RegExp(`^${escapedVendor}\\s+`, 'i'), '')
    .replace(/\s*[-–—]?\s*5\s?ml\b/gi, '').trim();
  context.font = '46px Georgia, serif';
  const vendorLines = wrapLabel(context, vendor.toUpperCase(), 500, 2);
  for (const [index, text] of vendorLines.entries()) context.fillText(text, 768, 174 + index * 51);
  context.font = '58px Georgia, serif';
  const titleLines = wrapLabel(context, title, 550, 3);
  const start = 342 - (titleLines.length - 1) * 33;
  for (const [index, text] of titleLines.entries()) context.fillText(text, 768, start + index * 66);
  context.font = 'italic 32px Georgia, serif';
  context.fillText(product.concentration || 'Fragrance decant', 768, 550);
  context.font = '25px sans-serif';
  context.fillText('5 ML  ·  BASE NOTE', 768, 660);
  // The label wraps completely, with a quiet rear mark that rewards inspection.
  context.font = '26px Georgia, serif';
  context.fillText('BASE NOTE', 70, 340);
  context.font = '18px sans-serif';
  context.fillText('5 ML', 70, 389);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function contactTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 3, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(54,45,29,.32)');
  gradient.addColorStop(0.35, 'rgba(54,45,29,.16)');
  gradient.addColorStop(1, 'rgba(54,45,29,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function cylinder(radius, height, material, y, parent, name, segments = 64) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), material);
  mesh.position.y = y;
  mesh.name = name;
  parent.add(mesh);
  return mesh;
}

function buildVial(product) {
  const body = new THREE.Group();
  body.name = 'Base Note 5 ml atomizer';
  body.rotation.z = -0.11;
  body.position.y = -2.0;

  const metal = new THREE.MeshStandardMaterial({ color: '#d4d5d3', metalness: 1, roughness: 0.16 });
  const rimMetal = new THREE.MeshStandardMaterial({ color: '#b9b9b3', metalness: 1, roughness: 0.22 });
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: '#f8f4e8', roughness: 0.06, metalness: .18, transmission: 0,
    thickness: 0.12, ior: 1.46, transparent: true, opacity: .3,
    attenuationColor: '#ebe9de', attenuationDistance: 4,
    clearcoat: 1, clearcoatRoughness: 0.025, side: THREE.FrontSide,
  });
  // Lathed profile: substantial glass foot, straight cylinder, rounded shoulder.
  const profile = [[0, 0.02], [.35, .02], [.46, .035], [.49, .075], [.5, .14],
    [.5, 2.7], [.487, 2.77], [.45, 2.82], [.407, 2.85], [.402, 2.96],
    [.345, 2.96], [.345, 2.83], [.445, 2.68], [.446, .22], [0, .22]];
  const glass = new THREE.Mesh(new THREE.LatheGeometry(profile.map(point => new THREE.Vector2(...point)), 96), glassMaterial);
  glass.name = 'Clear glass body';
  glass.renderOrder = 1;
  body.add(glass);
  const liquidMaterial = new THREE.MeshPhysicalMaterial({
    color: '#bd9138', roughness: .18, transmission: 0, thickness: .72,
    ior: 1.33, transparent: true, opacity: .45, clearcoat: 1,
  });
  cylinder(.442, 2.29, liquidMaterial, 1.365, body, 'Fragrance liquid');
  const glassEdgeMaterial = new THREE.MeshPhysicalMaterial({ color: '#d8d8cf', metalness: .28, roughness: .1, transparent: true, opacity: .62, clearcoat: 1 });
  for (const [radius, y, thickness] of [[.477, .115, .025], [.469, 2.775, .012], [.405, 2.855, .013]]) {
    const edge = new THREE.Mesh(new THREE.TorusGeometry(radius, thickness, 10, 80), glassEdgeMaterial);
    edge.rotation.x = Math.PI / 2;
    edge.position.y = y;
    body.add(edge);
  }
  const tube = cylinder(.021, 2.63, new THREE.MeshPhysicalMaterial({
    color: '#edece5', transmission: .5, transparent: true, opacity: .7, roughness: .1,
  }), 1.54, body, 'Atomizer dip tube', 16);
  tube.position.z = .075;
  cylinder(.415, .135, rimMetal, 2.93, body, 'Silver collar');
  cylinder(.289, .31, metal, 3.13, body, 'Spray pump');
  cylinder(.208, .16, new THREE.MeshStandardMaterial({ color: '#eeeae0', roughness: .4 }), 3.35, body, 'Spray head');
  const nozzle = new THREE.Mesh(new THREE.CircleGeometry(.04, 20), new THREE.MeshStandardMaterial({ color: '#60625d', roughness: .5 }));
  nozzle.position.set(0, 3.355, .21);
  body.add(nozzle);

  const cap = new THREE.Group();
  cap.name = 'Removable silver cap';
  cap.position.y = 2.955;
  body.add(cap);
  const capProfile = [[.443, .012], [.45, .035], [.45, 1.12], [.43, 1.153],
    [.0, 1.153], [.0, 1.115], [.411, 1.115], [.414, .04], [.425, .012], [.443, .012]];
  cap.add(new THREE.Mesh(new THREE.LatheGeometry(capProfile.map(point => new THREE.Vector2(...point)), 96), metal));
  const capEdge = new THREE.Mesh(new THREE.TorusGeometry(.437, .008, 8, 64), rimMetal);
  capEdge.rotation.x = Math.PI / 2;
  capEdge.position.y = .019;
  cap.add(capEdge);
  const label = new THREE.Mesh(new THREE.CylinderGeometry(.504, .504, 1.24, 96, 1, true),
    new THREE.MeshBasicMaterial({ map: labelTexture(product), transparent: true, side: THREE.FrontSide, toneMapped: false }));
  label.position.y = 1.49;
  label.rotation.y = Math.PI;
  label.name = 'Fragrance label';
  // Opaque paper sits outside the clear glass and stays readable in every light.
  label.renderOrder = 2;
  body.add(label);
  return { body, cap, label };
}

/**
 * @param {HTMLElement} host - vial-studio element with a data-studio-canvas child.
 * @param {object} product - Shopify product/variant data; used only for the label.
 * @returns {{ update: Function, action: Function, dispose: Function, inspect: Function }}
 */
export function createVialStudio(host, product) {
  const canvas = host.querySelector('[data-studio-canvas]');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.background);
  const camera = new THREE.PerspectiveCamera(33, 1, .05, 50);
  const room = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, .025);
  scene.environment = environment.texture;
  scene.environmentIntensity = 1.2;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight('#fffdf5', '#aca58f', .9));
  const key = new THREE.DirectionalLight('#ffffff', 2);
  key.position.set(-3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#fff0d3', 1.8);
  rim.position.set(4, 2, -3);
  scene.add(rim);
  const { body, cap, label } = buildVial(product);
  scene.add(body);
  const contactMap = contactTexture();
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2), new THREE.MeshBasicMaterial({
    map: contactMap, transparent: true, depthWrite: false, opacity: .62,
  }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(.07, -2.055, 0);
  scene.add(shadow);

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const current = { ...REST };
  const target = { ...REST };
  const abort = new AbortController();
  let frame = 0;
  let disposed = false;
  let inView = true;
  let pointer = null;

  function positionCamera() {
    const horizontal = Math.cos(current.pitch) * current.distance;
    camera.position.set(Math.sin(current.yaw) * horizontal, Math.sin(current.pitch) * current.distance + current.targetY, Math.cos(current.yaw) * horizontal);
    camera.lookAt(0, current.targetY, 0);
    cap.position.y = 2.955 + current.open * 1.23;
    cap.position.x = current.open * .12;
    cap.rotation.z = current.open * -.05;
    shadow.visible = camera.position.y > -1.8;
  }

  function render() {
    frame = 0;
    if (disposed || !inView || document.hidden) return;
    let moving = false;
    for (const field of Object.keys(target)) {
      const difference = target[field] - current[field];
      if (Math.abs(difference) > .0008) {
        current[field] += reducedMotion.matches ? difference : difference * .14;
        moving = true;
      } else current[field] = target[field];
    }
    positionCamera();
    renderer.render(scene, camera);
    if (moving) frame = requestAnimationFrame(render);
  }

  function requestRender() {
    if (!frame && !disposed && inView) frame = requestAnimationFrame(render);
  }

  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = 33 * Math.max(1, .83 / camera.aspect);
    camera.updateProjectionMatrix();
    requestRender();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const visibility = new IntersectionObserver(entries => {
    inView = entries[0].isIntersecting;
    if (inView) requestRender();
    else if (frame) { cancelAnimationFrame(frame); frame = 0; }
  });
  visibility.observe(canvas);
  document.addEventListener('visibilitychange', requestRender, { signal: abort.signal });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    host.dispatchEvent(new CustomEvent('vial-studio:render-error'));
  }, { signal: abort.signal });

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, touch: event.pointerType === 'touch', active: event.pointerType !== 'touch' };
    if (pointer.active) canvas.setPointerCapture(event.pointerId);
  }, { signal: abort.signal });
  canvas.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (!pointer.active) {
      const totalX = Math.abs(event.clientX - pointer.startX);
      const totalY = Math.abs(event.clientY - pointer.startY);
      if (totalY > totalX && totalY > 6) { pointer = null; return; }
      if (totalX < 6) return;
      pointer.active = true;
      canvas.setPointerCapture(event.pointerId);
    }
    target.yaw -= dx * .012;
    if (!pointer.touch) target.pitch = THREE.MathUtils.clamp(target.pitch + dy * .009, -1.42, 1.42);
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    requestRender();
  }, { signal: abort.signal });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(name, () => { pointer = null; }, { signal: abort.signal });
  }

  function action(name) {
    if (name === 'reverse') { target.yaw += Math.PI; target.pitch = .075; target.distance = 8.85; target.targetY = 0; }
    if (name === 'detail') { target.yaw = -.32; target.pitch = .1; target.distance = 5.1; target.targetY = .7; }
    if (name === 'open') { target.open = target.open ? 0 : 1; target.distance = target.open ? 10.1 : REST.distance; target.targetY = target.open ? .55 : 0; }
    if (name === 'reset') Object.assign(target, REST);
    if (name === 'zoom-in') target.distance = Math.max(4.3, target.distance - .8);
    if (name === 'zoom-out') target.distance = Math.min(12, target.distance + .8);
    if (name === 'left') target.yaw -= .38;
    if (name === 'right') target.yaw += .38;
    if (name === 'up') target.pitch = Math.min(1.42, target.pitch + .27);
    if (name === 'down') target.pitch = Math.max(-1.42, target.pitch - .27);
    host.dataset.capOpen = String(Boolean(target.open));
    requestRender();
    return { open: Boolean(target.open) };
  }

  canvas.addEventListener('keydown', event => {
    const actions = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out', Home: 'reset' };
    if (!actions[event.key]) return;
    event.preventDefault();
    action(actions[event.key]);
  }, { signal: abort.signal });

  positionCamera();
  resize();
  // Compile and render before revealing the canvas so fallback never flashes blank.
  renderer.render(scene, camera);
  return {
    update(nextProduct) {
      label.material.map.dispose();
      label.material.map = labelTexture(nextProduct);
      label.material.needsUpdate = true;
      requestRender();
    },
    action,
    inspect: () => ({ current: { ...current }, target: { ...target }, inView, triangles: renderer.info.render.triangles, calls: renderer.info.render.calls, capY: cap.position.y, label: label.name }),
    dispose() {
      disposed = true;
      abort.abort();
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibility.disconnect();
      const materials = new Set();
      scene.traverse(object => { object.geometry?.dispose(); if (object.material) materials.add(object.material); });
      for (const material of materials) { material.map?.dispose(); material.dispose(); }
      environment.dispose();
      renderer.dispose();
    },
  };
}
