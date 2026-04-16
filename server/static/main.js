// 3D Visualizer Setup
let CUBE_SIZE = 8;
const voxelSpacing = 1.2;
let voxels = []; // 3D array of meshes

// Three.js SCENE
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000); // aspect updated dynamically
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });

document.getElementById('three-canvas').appendChild(renderer.domElement);
const sidebarEl = document.querySelector('.sidebar');

const updateRendererSize = () => {
    const sidebarWidth = sidebarEl ? sidebarEl.offsetWidth : 380;
    const width = window.innerWidth - sidebarWidth;
    camera.aspect = width / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(width, window.innerHeight);
};
updateRendererSize();

// Controls
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(20, 30, 20);
scene.add(dirLight);

// Group to hold all voxels
const cubeGroup = new THREE.Group();
scene.add(cubeGroup);

// Shared geometry for all voxel spheres
const sharedGeometry = new THREE.SphereGeometry(0.35, 16, 16);
const baseMaterial = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.1, side: THREE.DoubleSide });

let wireframeLine = null;

// Create or rebuild the voxel grid for the current CUBE_SIZE
const buildVoxelGrid = (size) => {
    // Clear previous grid
    while (cubeGroup.children.length > 0) {
        cubeGroup.remove(cubeGroup.children[0]);
    }
    voxels = [];
    wireframeLine = null;

    const offset = voxelSpacing / 2;

    for (let x = 0; x < size; x++) {
        voxels[x] = [];
        for (let y = 0; y < size; y++) {
            voxels[x][y] = [];
            for (let z = 0; z < size; z++) {
                const mesh = new THREE.Mesh(sharedGeometry, baseMaterial.clone());
                
                // Position relative to center: Upper Front Right octant
                mesh.position.set(
                    (x * voxelSpacing) + offset, // X in three.js is Right
                    (y * voxelSpacing) + offset, // Y in three.js is UP, mapping data Y to height
                    (z * voxelSpacing) + offset  // Z in three.js is Front (towards face), mapping data Z to depth
                );
                
                cubeGroup.add(mesh);
                voxels[x][y][z] = mesh;
            }
        }
    }
    
    // Wireframe Box Outline
    const boxSize = size * voxelSpacing;
    const boxGeo = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
    boxGeo.translate(boxSize / 2, boxSize / 2, boxSize / 2);
    
    const edges = new THREE.EdgesGeometry(boxGeo);
    wireframeLine = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x334155 }));
    cubeGroup.add(wireframeLine);
    
    // ─── Axis Lines & Labels ─────────────────────────
    const axisLen = boxSize + 1.5;  // Extend slightly beyond the box
    const axisOrigin = -0.3;        // Start slightly before the box corner
    
    const makeAxisLine = (color, start, end) => {
        const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
        const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
        return new THREE.Line(geo, mat);
    };
    
    const makeLabel = (text, color, position) => {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.font = 'bold 48px monospace';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 32, 32);
        
        const texture = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(mat);
        sprite.position.copy(position);
        sprite.scale.set(1.2, 1.2, 1);
        return sprite;
    };
    
    // X axis — Red
    cubeGroup.add(makeAxisLine(0xff4444, 
        new THREE.Vector3(axisOrigin, axisOrigin, axisOrigin), 
        new THREE.Vector3(axisLen, axisOrigin, axisOrigin)));
    cubeGroup.add(makeLabel('X', '#ff4444', new THREE.Vector3(axisLen + 0.5, axisOrigin, axisOrigin)));
    
    // Y axis — Green
    cubeGroup.add(makeAxisLine(0x44ff44, 
        new THREE.Vector3(axisOrigin, axisOrigin, axisOrigin), 
        new THREE.Vector3(axisOrigin, axisLen, axisOrigin)));
    cubeGroup.add(makeLabel('Y', '#44ff44', new THREE.Vector3(axisOrigin, axisLen + 0.5, axisOrigin)));
    
    // Z axis — Blue
    cubeGroup.add(makeAxisLine(0x4488ff, 
        new THREE.Vector3(axisOrigin, axisOrigin, axisOrigin), 
        new THREE.Vector3(axisOrigin, axisOrigin, axisLen)));
    cubeGroup.add(makeLabel('Z', '#4488ff', new THREE.Vector3(axisOrigin, axisOrigin, axisLen + 0.5)));
};

buildVoxelGrid(CUBE_SIZE);

camera.position.set(15, 12, 15);
controls.target.set(0, 0, 0);

// Animation Loop
let frameCount = 0;
let lastTime = performance.now();

const animate = () => {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    
    // Basic FPS calculation
    frameCount++;
    const now = performance.now();
    if (now - lastTime >= 1000) {
        document.getElementById('fps-counter').innerText = frameCount;
        frameCount = 0;
        lastTime = now;
    }
};

animate();

// Handle Window and Sidebar Resize
window.addEventListener('resize', updateRendererSize);
if (sidebarEl) {
    new ResizeObserver(updateRendererSize).observe(sidebarEl);
}

// WebSocket Connection
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${window.location.host}/ws`;
let ws;

const connectWebSocket = () => {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log("WebSocket connected.");
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        const gs = data.grid_size || CUBE_SIZE;
        
        // Rebuild grid if size changed
        if (gs !== CUBE_SIZE) {
            CUBE_SIZE = gs;
            buildVoxelGrid(CUBE_SIZE);
        }
        
        if (data.voxels && data.voxels.length === gs * gs * gs * 3) {
            updateVoxels(data.voxels, gs);
        }
    };

    ws.onclose = () => {
        console.log("WebSocket disconnected. Reconnecting...");
        setTimeout(connectWebSocket, 2000); // Auto reconnect
    };
};

// Map flattened 1D array to our 3D Three.JS meshes
const updateVoxels = (flatArray, gs) => {
    let activeCount = 0;
    let powerEstimate = 0; // rough calculation
    
    for (let x = 0; x < gs; x++) {
        for (let y = 0; y < gs; y++) {
            for (let z = 0; z < gs; z++) {
                // The flat array indexing matches Python's numpy flatten()
                // order: x, then y, then z
                const idx = (x * gs * gs + y * gs + z) * 3;
                
                const r = flatArray[idx] / 255.0;
                const g = flatArray[idx+1] / 255.0;
                const b = flatArray[idx+2] / 255.0;
                
                const mesh = voxels[x][y][z];
                
                if (r > 0 || g > 0 || b > 0) {
                    mesh.material.color.setRGB(r, g, b);
                    // Dynamically adjust opacity based on color intensity
                    const maxIntensity = Math.max(r, g, b);
                    mesh.material.opacity = 0.15 + (maxIntensity * 0.75); 
                    activeCount++;
                    
                    // Rough current rule of thumb: 20mA per color channel at full brightness
                    powerEstimate += (r + g + b) * 20; 
                } else {
                    mesh.material.color.setHex(0x111111);
                    mesh.material.opacity = 0.05; // Make inactive ones almost invisible
                }
            }
        }
    }
    
    document.getElementById('voxel-counter').innerText = activeCount;
    const amps = (powerEstimate / 1000).toFixed(1);
    document.getElementById('power-counter').innerText = `~${amps}A`;
};

// API Interactions
const btnUpdate = document.getElementById('btn-update');
const btnStream = document.getElementById('btn-stream');
const tabBtns = document.querySelectorAll('.tab-btn');
const serialPortInput = document.getElementById('serial-port');
const usbSettings = document.getElementById('usb-settings');
const wifiSettings = document.getElementById('wifi-settings');
let isStreaming = false;
let selectedMode = 'usb';

// Handle Tab Switching
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        if (isStreaming) return; // Prevent switching while active
        
        selectedMode = btn.dataset.mode;
        
        // UI Updates
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        usbSettings.style.display = selectedMode === 'usb' ? 'block' : 'none';
        wifiSettings.style.display = selectedMode === 'wifi' ? 'block' : 'none';
        
        const modeLabel = selectedMode === 'usb' ? 'USB' : 'WiFi';
        btnStream.innerHTML = `<span class="status-indicator" id="stream-status"></span> Start ${modeLabel} Streaming`;
    });
});

// Manage dynamic equation fields
const container = document.getElementById('equations-container');
const btnAddEq = document.getElementById('btn-add-eq');
const eqColors = ['#ff3c3c', '#3cff3c', '#3c3cff', '#ffff3c', '#ff3cff'];
let eqCount = 0;

// Auto-Render Logic
const autoRenderToggle = document.getElementById('auto-render-toggle');
let autoRenderTimeout = null;

const triggerAutoRender = () => {
    if (autoRenderToggle.checked) {
        clearTimeout(autoRenderTimeout);
        autoRenderTimeout = setTimeout(() => {
            document.getElementById('btn-update').click();
        }, 400); // 400ms debounce
    }
};

const addEquationRow = (defaultValue = "", overrideColor = null) => {
    const row = document.createElement('div');
    row.className = 'equation-row';
    const color = overrideColor || eqColors[eqCount % eqColors.length];
    
    // Set up layout with textarea
    row.innerHTML = `
        <input type="color" class="eq-color" value="${color}" style="border: none; width: 24px; height: 28px; padding: 0; background: none; cursor: pointer; border-radius: 4px; margin-right: 0.5rem; flex-shrink: 0;" title="Change Graph Color">
        <textarea class="eq-input" placeholder="e.g. z = sin(x) or x**2+y**2 < 16" rows="1">${defaultValue}</textarea>
        <button class="btn-remove" title="Remove Field" style="flex-shrink: 0;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
    `;
    
    // Remove button logic
    row.querySelector('.btn-remove').addEventListener('click', () => {
        if (container.children.length > 1) {
            row.remove();
            triggerAutoRender();
        }
    });
    
    // Auto-expand logic for textareas
    const textarea = row.querySelector('.eq-input');
    const autoExpand = () => {
        textarea.style.height = 'auto'; // Reset to auto to calculate true scrollHeight
        textarea.style.height = textarea.scrollHeight + 'px';
    };
    
    // Apply changes on input
    textarea.addEventListener('input', () => {
        autoExpand();
        triggerAutoRender();
    });
    
    row.querySelector('.eq-color').addEventListener('input', triggerAutoRender);
    
    container.appendChild(row);
    eqCount++;
    
    // Initial expansion setup right after appending
    setTimeout(autoExpand, 0);
};

// Initial default rows
addEquationRow("z = 4.5 + 3.5 * sin(sqrt((x-4.5)**2 + (y-4.5)**2) - t * 2)");
addEquationRow("z = 4.5 + 3.5 * cos((x-4.5) + t)");

btnAddEq.addEventListener('click', () => {
    addEquationRow();
});

const btnHuygensDemo = document.getElementById('btn-huygens-demo');
btnHuygensDemo.addEventListener('click', async () => {
    container.innerHTML = '';
    eqCount = 0;
    
    // Read current grid size for dynamic scaling
    const gs = freeModeToggle.checked ? (parseInt(gridSizeInput.value) || 8) : 8;
    const C = ((gs + 1) / 2).toFixed(2);       // Center of grid
    const E = (gs * 0.85).toFixed(2);           // Edge wavelet spawn point  
    const D1 = (gs * 0.75).toFixed(2);          // Diagonal spawn (planar)
    const D2 = (gs * 0.70).toFixed(2);          // Diagonal spawn (volumetric)
    const T = (gs * 0.1).toFixed(2);            // Shell thickness (scales with grid)
    const R0 = (gs * 0.35).toFixed(2);          // Primary wavefront freeze radius
    const tDelay = "4.0";                       // Secondary wavefront delay

    const huygensEqs = [
        // Phase 1: Primary wavefront — expands from center, freezes at R0
        { c: "#ffffff", e: `abs((x-${C})**2 + (y-${C})**2 + (z-${C})**2 - clip(t, 0, ${R0})**2) < ${T}` },
        
        // Phase 2: Axis wavelets (vivid RGB) — spawn on the frozen primary shell surface
        { c: "#ff2020", e: `abs((x-${E})**2 + (y-${C})**2 + (z-${C})**2 - clip(t-${tDelay}, 0, 100)**2) < ${T} and (t > ${tDelay})` },
        { c: "#20ff40", e: `abs((x-${C})**2 + (y-${E})**2 + (z-${C})**2 - clip(t-${tDelay}, 0, 100)**2) < ${T} and (t > ${tDelay})` },
        { c: "#4080ff", e: `abs((x-${C})**2 + (y-${C})**2 + (z-${E})**2 - clip(t-${tDelay}, 0, 100)**2) < ${T} and (t > ${tDelay})` },

        // Phase 2: Planar diagonal wavelets (vivid Yellow, Cyan, Magenta)
        { c: "#ffe030", e: `abs((x-${D1})**2 + (y-${D1})**2 + (z-${C})**2 - clip(t-${tDelay}, 0, 100)**2) < ${T} and (t > ${tDelay})` },
        { c: "#30ffe0", e: `abs((x-${C})**2 + (y-${D1})**2 + (z-${D1})**2 - clip(t-${tDelay}, 0, 100)**2) < ${T} and (t > ${tDelay})` },
        { c: "#ff30e0", e: `abs((x-${D1})**2 + (y-${C})**2 + (z-${D1})**2 - clip(t-${tDelay}, 0, 100)**2) < ${T} and (t > ${tDelay})` },

        // Phase 2: Volumetric diagonal wavelet (orange-gold)
        { c: "#ff8800", e: `abs((x-${D2})**2 + (y-${D2})**2 + (z-${D2})**2 - clip(t-${tDelay}, 0, 100)**2) < ${T} and (t > ${tDelay})` },

        // Phase 2: Expanding envelope — continues from where the primary froze
        { c: "#00ffff", e: `abs((x-${C})**2 + (y-${C})**2 + (z-${C})**2 - clip(${R0} + (t-${tDelay}), 0, 100)**2) < ${T} and (t > ${tDelay})` }
    ];
    
    huygensEqs.forEach(conf => addEquationRow(conf.e, conf.c));
    
    // Auto-reset time to 0 and resume play
    isPlaying = true;
    btnPlayPause.innerText = "Pause";
    btnPlayPause.classList.toggle('primary', false);
    btnPlayPause.classList.toggle('secondary', true);
    
    await fetch('/api/update_time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ t_val: 0.0, is_playing: true, playback_speed: 0.5 })
    });
    
    // Submit arrays natively
    btnUpdate.click();
});

// ─── Coordinate Space Controls ───────────────────────
const originX = document.getElementById('origin-x');
const originY = document.getElementById('origin-y');
const originZ = document.getElementById('origin-z');
const scaleFactor = document.getElementById('scale-factor');
const btnOriginCorner = document.getElementById('btn-origin-corner');
const btnOriginCenter = document.getElementById('btn-origin-center');
const btnScaleReset = document.getElementById('btn-scale-reset');
const gridSizeInput = document.getElementById('grid-size');
const gridLabel = document.getElementById('grid-label');
const freeModeToggle = document.getElementById('free-mode-toggle');

// Origin presets
// Origin = "where in LED-space (1..N) does mathematical (0,0,0) sit"
// Formula in backend: coord[i] = ((i+1) - origin) * scale
btnOriginCorner.addEventListener('click', () => {
    // Corner: origin=0 means math (0,0,0) is at position 0 (before the cube)
    // At scale=1: LED coords = 1, 2, 3, ..., 8 (x=1 is first LED)
    originX.value = 0;
    originY.value = 0;
    originZ.value = 0;
    btnOriginCorner.classList.add('active');
    btnOriginCenter.classList.remove('active');
    triggerAutoRender();
});

btnOriginCenter.addEventListener('click', () => {
    const gs = parseInt(gridSizeInput.value) || 8;
    // Center: origin = (N+1)/2 means math (0,0,0) is at the geometric center
    // At scale=1 with N=8: origin=4.5, coords = -3.5, -2.5, ..., 3.5
    const center = (gs + 1) / 2;
    originX.value = center;
    originY.value = center;
    originZ.value = center;
    btnOriginCenter.classList.add('active');
    btnOriginCorner.classList.remove('active');
    triggerAutoRender();
});

// Scale reset: restore scale=1 and recompute origin for active preset
btnScaleReset.addEventListener('click', () => {
    scaleFactor.value = 1;
    document.getElementById('scale-label').innerText = '1.0';
    // Reapply whichever origin preset is active
    if (btnOriginCenter.classList.contains('active')) {
        btnOriginCenter.click();
    } else {
        btnOriginCorner.click();
    }
});

// Grid size 
gridSizeInput.addEventListener('input', () => {
    const gs = parseInt(gridSizeInput.value) || 8;
    gridLabel.innerText = `${gs}×${gs}×${gs}`;
});

// Free mode toggle: when OFF, lock grid back to 8
freeModeToggle.addEventListener('change', () => {
    if (!freeModeToggle.checked) {
        gridSizeInput.value = 8;
        gridLabel.innerText = '8×8×8';
    }
    gridSizeInput.disabled = !freeModeToggle.checked;
    triggerAutoRender();
});

// Auto-render triggers for origin inputs (manual edits)
[originX, originY, originZ].forEach(el => {
    el.addEventListener('input', () => {
        // Manual origin edit clears the preset highlight
        btnOriginCorner.classList.remove('active');
        btnOriginCenter.classList.remove('active');
        triggerAutoRender();
    });
});

// When scale changes, update label and recompute origin if a preset is active
scaleFactor.addEventListener('input', () => {
    document.getElementById('scale-label').innerText = parseFloat(scaleFactor.value).toFixed(1);
    if (btnOriginCenter.classList.contains('active')) {
        btnOriginCenter.click();
    } else if (btnOriginCorner.classList.contains('active')) {
        btnOriginCorner.click();
    } else {
        triggerAutoRender();
    }
});

gridSizeInput.addEventListener('input', triggerAutoRender);

// Playback Controls
const btnPlayPause = document.getElementById('btn-play-pause');
const tScrubber = document.getElementById('t-scrubber');
const speedSlider = document.getElementById('speed-slider');
const speedLabel = document.getElementById('speed-label');
const tValDisplay = document.getElementById('t-val-display');
let isPlaying = true;
let isScrubbing = false;

// Sync time from backend occasionally
setInterval(async () => {
    if (!isScrubbing && isPlaying) {
        try {
            const res = await fetch('/api/update_time', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}) // Just fetch current state
            });
            const data = await res.json();
            tScrubber.value = data.t % 100; // Loop scrubber visually 0-100
            tValDisplay.innerText = data.t.toFixed(1);
        } catch(e) {}
    }
}, 500);

btnPlayPause.addEventListener('click', async () => {
    isPlaying = !isPlaying;
    btnPlayPause.innerText = isPlaying ? "Pause" : "Play";
    btnPlayPause.classList.toggle('primary', !isPlaying);
    btnPlayPause.classList.toggle('secondary', isPlaying);
    
    await fetch('/api/update_time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_playing: isPlaying })
    });
});

tScrubber.addEventListener('mousedown', () => isScrubbing = true);
tScrubber.addEventListener('mouseup', () => isScrubbing = false);
tScrubber.addEventListener('input', async (e) => {
    const newT = parseFloat(e.target.value);
    tValDisplay.innerText = newT.toFixed(1);
    await fetch('/api/update_time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ t_val: newT })
    });
});

speedSlider.addEventListener('input', async (e) => {
    const speed = parseFloat(e.target.value);
    speedLabel.innerText = speed.toFixed(1);
    await fetch('/api/update_time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playback_speed: speed })
    });
});

// UI Wiring: Brightness Slider
const brightnessSlider = document.getElementById('brightness-slider');
const brightLabel = document.getElementById('bright-label');
if (brightnessSlider && brightLabel) {
    brightnessSlider.addEventListener('input', (e) => {
        brightLabel.innerText = e.target.value;
        triggerAutoRender();
    });
}

btnUpdate.addEventListener('click', async () => {
    // Collect all inputs and colors
    const rows = document.querySelectorAll('.equation-row');
    const eqArray = [];
    const colorArray = [];
    
    rows.forEach(row => {
        const inputVal = row.querySelector('.eq-input').value;
        if (inputVal.trim() !== "") {
            eqArray.push(inputVal);
            colorArray.push(row.querySelector('.eq-color').value);
        }
    });

    // Collect coordinate space settings
    const ox = parseFloat(originX.value) || 0;
    const oy = parseFloat(originY.value) || 0;
    const oz = parseFloat(originZ.value) || 0;
    const sf = parseFloat(scaleFactor.value) || 1;
    const gs = freeModeToggle.checked ? (parseInt(gridSizeInput.value) || 8) : 8;

    // Brightness setting
    const brightnessSlider = document.getElementById('brightness-slider');
    const brightVal = brightnessSlider ? parseFloat(brightnessSlider.value) / 100.0 : 0.2;

    try {
        const response = await fetch('/api/update_plot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                equations: eqArray, 
                colors: colorArray,
                origin_x: ox,
                origin_y: oy,
                origin_z: oz,
                scale: sf,
                grid_size: gs,
                brightness: brightVal
            })
        });
        cubeGroup.rotation.y = 0; // Reset rotation so user can see front view
    } catch (e) {
        console.error("Failed to update plot", e);
    }
});

btnStream.addEventListener('click', async () => {
    isStreaming = !isStreaming;
    const port = selectedMode === 'usb' ? serialPortInput.value : document.getElementById('wifi-ip').value;
    
    try {
        const res = await fetch('/api/toggle_stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stream: isStreaming, mode: selectedMode, port: port })
        });
        const result = await res.json();
        
        if (result.status === 'error') {
            alert('Connection failed: ' + result.message);
            isStreaming = false;
            return;
        }
        
        const streamStatus = document.getElementById('stream-status');
        const modeLabel = selectedMode === 'usb' ? 'USB' : 'WiFi';
        
        if (isStreaming) {
            btnStream.classList.add('active');
            btnStream.innerHTML = `<span class="status-indicator streaming" id="stream-status"></span> Stop ${modeLabel} Streaming`;
        } else {
            btnStream.classList.remove('active');
            btnStream.innerHTML = `<span class="status-indicator" id="stream-status"></span> Start ${modeLabel} Streaming`;
        }
    } catch (e) {
        console.error("Failed to toggle stream", e);
        isStreaming = false;
    }
});

// Init
connectWebSocket();
// Trigger initial calculation
setTimeout(() => btnUpdate.click(), 500);

// ─── Math Keyboard ───────────────────────────────────
const mathKbToggle = document.getElementById('btn-math-kb');
const mathKbPanel = document.getElementById('math-keyboard');
const mathKbClose = document.getElementById('btn-close-math-kb');
let lastFocusedTextarea = null;

// Track which equation textarea was last focused
document.addEventListener('focusin', (e) => {
    if (e.target.classList.contains('eq-input')) {
        lastFocusedTextarea = e.target;
    }
});

// Toggle panel
mathKbToggle.addEventListener('click', () => {
    const isOpen = mathKbPanel.classList.toggle('open');
    mathKbToggle.classList.toggle('active', isOpen);
});

// Close button
mathKbClose.addEventListener('click', () => {
    mathKbPanel.classList.remove('open');
    mathKbToggle.classList.remove('active');
});

// Insert function at cursor position in the last focused textarea
document.querySelectorAll('.math-kb-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const insertText = btn.dataset.insert;
        
        // If no textarea was focused yet, use the first one
        if (!lastFocusedTextarea) {
            lastFocusedTextarea = document.querySelector('.eq-input');
        }
        if (!lastFocusedTextarea) return;
        
        const ta = lastFocusedTextarea;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const before = ta.value.substring(0, start);
        const after = ta.value.substring(end);
        
        ta.value = before + insertText + after;
        
        // Place cursor inside parentheses if the insert ends with ()
        let cursorPos;
        if (insertText.endsWith('()')) {
            cursorPos = start + insertText.length - 1;
        } else if (insertText.includes('(') && insertText.includes(')')) {
            // For templates like clip(, 0, 100) — put cursor after first (
            cursorPos = start + insertText.indexOf('(') + 1;
        } else {
            cursorPos = start + insertText.length;
        }
        
        ta.setSelectionRange(cursorPos, cursorPos);
        ta.focus();
        
        // Trigger auto-expand and auto-render
        ta.dispatchEvent(new Event('input'));
    });
});
