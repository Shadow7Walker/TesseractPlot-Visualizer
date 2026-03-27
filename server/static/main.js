// 3D Visualizer Setup
const CUBE_SIZE = 8;
const voxelSpacing = 1.2;
const voxels = []; // 3D array of meshes

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

// Group to hold the virtual mirror clones
const mirrorsGroup = new THREE.Group();
scene.add(mirrorsGroup);

// Create the 16x16x16 grid of spheres (representing LEDs in tubes)
const createVoxelGrid = () => {
    // Basic material (will be updated via WebSocket)
    const geometry = new THREE.SphereGeometry(0.35, 16, 16);
    const material = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.1, side: THREE.DoubleSide });

    const offset = voxelSpacing / 2;

    for (let x = 0; x < CUBE_SIZE; x++) {
        voxels[x] = [];
        for (let y = 0; y < CUBE_SIZE; y++) {
            voxels[x][y] = [];
            for (let z = 0; z < CUBE_SIZE; z++) {
                const mesh = new THREE.Mesh(geometry, material.clone());
                
                // Position relative to center, constrained explicitly to the positive octant
                mesh.position.set(
                    (x * voxelSpacing) + offset,
                    (z * voxelSpacing) + offset, // Y in three.js is UP, but our data has Z as UP
                    (y * voxelSpacing) + offset  // So mapping y(data)->z(three) and z(data)->y(three)
                );
                
                cubeGroup.add(mesh);
                voxels[x][y][z] = mesh;
            }
        }
    }
    
    // Wireframe Box Outline
    const boxSize = CUBE_SIZE * voxelSpacing;
    const boxGeo = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
    boxGeo.translate(boxSize / 2, boxSize / 2, boxSize / 2);
    
    const edges = new THREE.EdgesGeometry(boxGeo);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x334155 }));
    cubeGroup.add(line);
    
    // Create 7 cloned mirror groups representing the 3 physical reflections
    const scales = [
        [-1, 1, 1], [1, -1, 1], [-1, -1, 1],
        [1, 1, -1], [-1, 1, -1], [1, -1, -1], [-1, -1, -1]
    ];
    
    scales.forEach(([sx, sy, sz]) => {
        const clone = cubeGroup.clone();
        clone.scale.set(sx, sy, sz);
        mirrorsGroup.add(clone);
    });
};

createVoxelGrid();

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

// UI: Toggle Mirrors
const btnToggleMirrors = document.getElementById('btn-toggle-mirrors');
let mirrorsEnabled = true;

btnToggleMirrors.addEventListener('click', () => {
    mirrorsEnabled = !mirrorsEnabled;
    mirrorsGroup.visible = mirrorsEnabled;
    btnToggleMirrors.innerText = mirrorsEnabled ? 'Disable UI Mirrors' : 'Enable UI Mirrors';
    btnToggleMirrors.classList.toggle('primary', !mirrorsEnabled);
    btnToggleMirrors.classList.toggle('secondary', mirrorsEnabled);
});

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
        document.getElementById('hardware-status-dot').className = 'status-indicator connected';
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.voxels && data.voxels.length === CUBE_SIZE * CUBE_SIZE * CUBE_SIZE * 3) {
            updateVoxels(data.voxels);
        }
    };

    ws.onclose = () => {
        document.getElementById('hardware-status-dot').className = 'status-indicator';
        setTimeout(connectWebSocket, 2000); // Auto reconnect
    };
};

// Map flattened 1D array to our 3D Three.JS meshes
const updateVoxels = (flatArray) => {
    let activeCount = 0;
    let powerEstimate = 0; // rough calculation
    
    for (let x = 0; x < CUBE_SIZE; x++) {
        for (let y = 0; y < CUBE_SIZE; y++) {
            for (let z = 0; z < CUBE_SIZE; z++) {
                // The flat array indexing matches Python's numpy flatten()
                // order: x, then y, then z
                const idx = (x * CUBE_SIZE * CUBE_SIZE + y * CUBE_SIZE + z) * 3;
                
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
const ipInput = document.getElementById('esp_ip');
let isStreaming = false;

// Manage dynamic equation fields
const container = document.getElementById('equations-container');
const btnAddEq = document.getElementById('btn-add-eq');
const eqColors = ['#ff3c3c', '#3cff3c', '#3c3cff', '#ffff3c', '#ff3cff'];
let eqCount = 0;

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
        }
    });
    
    container.appendChild(row);
    eqCount++;
};

// Initial default rows
addEquationRow("z = 4 * sin(sqrt(x**2 + y**2) - t * 2)");
addEquationRow("z = 4 * cos(x + t)");

btnAddEq.addEventListener('click', () => {
    addEquationRow();
});

const btnHuygensDemo = document.getElementById('btn-huygens-demo');
btnHuygensDemo.addEventListener('click', async () => {
    container.innerHTML = '';
    eqCount = 0;
    
    const huygensEqs = [
        { c: "#ffffff", e: "abs(x**2 + y**2 + z**2 - clip(t, 0, 3.0)**2) < 0.8" }, // Primary wavefront freezes at t=3.0
        
        // 3 Axis wavelets (Red, Green, Blue) starting at t=4.0
        { c: "#ff3c3c", e: "abs((x - 3.0)**2 + y**2 + z**2 - clip(t-4.0, 0, 100)**2) < 0.8 and (t > 4.0)" },
        { c: "#3cff3c", e: "abs(x**2 + (y - 3.0)**2 + z**2 - clip(t-4.0, 0, 100)**2) < 0.8 and (t > 4.0)" },
        { c: "#3c3cff", e: "abs(x**2 + y**2 + (z - 3.0)**2 - clip(t-4.0, 0, 100)**2) < 0.8 and (t > 4.0)" },

        // 3 Planar diagonal wavelets (Yellow, Cyan, Magenta) 
        { c: "#ffff3c", e: "abs((x - 2.12)**2 + (y - 2.12)**2 + z**2 - clip(t-4.0, 0, 100)**2) < 0.8 and (t > 4.0)" },
        { c: "#3cffff", e: "abs(x**2 + (y - 2.12)**2 + (z - 2.12)**2 - clip(t-4.0, 0, 100)**2) < 0.8 and (t > 4.0)" },
        { c: "#ff3cff", e: "abs((x - 2.12)**2 + y**2 + (z - 2.12)**2 - clip(t-4.0, 0, 100)**2) < 0.8 and (t > 4.0)" },

        // 1 Volumetric exact diagonal wavelet (White)
        { c: "#ffffff", e: "abs((x - 1.73)**2 + (y - 1.73)**2 + (z - 1.73)**2 - clip(t-4.0, 0, 100)**2) < 0.8 and (t > 4.0)" },

        // Infinite Expanding Envelope
        { c: "#00ffff", e: "abs(x**2 + y**2 + z**2 - clip(3.0 + (t-4.0), 0, 100)**2) < 0.8 and (t > 4.0)" }
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
    
    const ip = ipInput.value;
    
    try {
        await fetch('/api/update_plot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ equations: eqArray, colors: colorArray, esp32_ip: ip })
        });
        cubeGroup.rotation.y = 0; // Reset rotation so user can see front view
    } catch (e) {
        console.error("Failed to update plot", e);
    }
});

btnStream.addEventListener('click', async () => {
    isStreaming = !isStreaming;
    
    try {
        await fetch('/api/toggle_stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stream: isStreaming })
        });
        
        const statusDot = document.getElementById('hardware-status-dot');
        
        if (isStreaming) {
            btnStream.classList.add('active');
            btnStream.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2" ry="2"/></svg> Stop Streaming`;
            statusDot.className = 'status-indicator streaming';
            statusDot.nextElementSibling.innerText = "Streaming via UDP";
        } else {
            btnStream.classList.remove('active');
            btnStream.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg> Stream to Hardware`;
            statusDot.className = 'status-indicator connected'; // assume ws still connected
            statusDot.nextElementSibling.innerText = "Hardware Ready";
        }
    } catch (e) {
        console.error("Failed to toggle stream", e);
    }
});

// Init
connectWebSocket();
// Trigger initial calculation
setTimeout(() => btnUpdate.click(), 500);
