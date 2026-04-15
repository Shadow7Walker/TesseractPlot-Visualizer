// 3D Visualizer Setup
let CUBE_SIZE = 8;
const voxelSpacing = 1.2;
let voxels = []; // 3D array of meshes

// Three.js SCENE
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });

renderer.setSize(window.innerWidth - 320, window.innerHeight); // Subtract sidebar width
document.getElementById('three-canvas').appendChild(renderer.domElement);

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

// Handle Window Resize
window.addEventListener('resize', () => {
    const width = window.innerWidth - 320;
    camera.aspect = width / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(width, window.innerHeight);
});

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
                    mesh.material.opacity = 0.9;
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
    
    row.innerHTML = `
        <input type="color" class="eq-color" value="${color}" style="border: none; width: 24px; height: 28px; padding: 0; background: none; cursor: pointer; border-radius: 4px; margin-right: 0.5rem;" title="Change Graph Color">
        <input type="text" class="eq-input" value="${defaultValue}" placeholder="e.g. z = sin(x) or x**2+y**2 < 16">
        <button class="btn-remove" title="Remove Field">
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
    
    // Auto-render triggers
    row.querySelector('.eq-input').addEventListener('input', triggerAutoRender);
    row.querySelector('.eq-color').addEventListener('input', triggerAutoRender);
    
    container.appendChild(row);
    eqCount++;
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
    
    const huygensEqs = [
        { c: "#ffffff", e: "abs((x-4.5)**2 + (y-4.5)**2 + (z-4.5)**2 - clip(t, 0, 3.0)**2) < 0.8" }, // Primary wavefront freezes at t=3.0
        
        // 3 Axis wavelets (Red, Green, Blue) starting at t=4.0
        { c: "#ff3c3c", e: "abs((x-7.5)**2 + (y-4.5)**2 + (z-4.5)**2 - clip(t-4.0, 0, 100)**2) < 0.8 and (t > 4.0)" },
        { c: "#3cff3c", e: "abs((x-4.5)**2 + (y-7.5)**2 + (z-4.5)**2 - clip(t-4.0, 0, 100)**2) < 0.8 and (t > 4.0)" },
        { c: "#3c3cff", e: "abs((x-4.5)**2 + (y-4.5)**2 + (z-7.5)**2 - clip(t-4.0, 0, 100)**2) < 0.8 and (t > 4.0)" },

        // 3 Planar diagonal wavelets (Yellow, Cyan, Magenta) 
        { c: "#ffff3c", e: "abs((x-6.62)**2 + (y-6.62)**2 + (z-4.5)**2 - clip(t-4.0, 0, 100)**2) < 0.8 and (t > 4.0)" },
        { c: "#3cffff", e: "abs((x-4.5)**2 + (y-6.62)**2 + (z-6.62)**2 - clip(t-4.0, 0, 100)**2) < 0.8 and (t > 4.0)" },
        { c: "#ff3cff", e: "abs((x-6.62)**2 + (y-4.5)**2 + (z-6.62)**2 - clip(t-4.0, 0, 100)**2) < 0.8 and (t > 4.0)" },

        // 1 Volumetric exact diagonal wavelet (White)
        { c: "#ffffff", e: "abs((x-6.23)**2 + (y-6.23)**2 + (z-6.23)**2 - clip(t-4.0, 0, 100)**2) < 0.8 and (t > 4.0)" },

        // Infinite Expanding Envelope
        { c: "#00ffff", e: "abs((x-4.5)**2 + (y-4.5)**2 + (z-4.5)**2 - clip(3.0 + (t-4.0), 0, 100)**2) < 0.8 and (t > 4.0)" }
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
                grid_size: gs
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
