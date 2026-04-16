// 3D Visualizer Setup
const CUBE_SIZE = 8;
const voxelSpacing = 2.0;
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

// Create the 8x8x8 grid of spheres 
const createVoxelGrid = () => {
    const geometry = new THREE.SphereGeometry(0.35, 16, 16);
    const material = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.1, side: THREE.DoubleSide });

    const offset = voxelSpacing / 2;
    // Calculate the shift needed to place the center of the 8x8x8 cube exactly at 0,0,0
    const centerShift = (CUBE_SIZE * voxelSpacing) / 2;

    for (let x = 0; x < CUBE_SIZE; x++) {
        voxels[x] = [];
        for (let y = 0; y < CUBE_SIZE; y++) {
            voxels[x][y] = [];
            for (let z = 0; z < CUBE_SIZE; z++) {
                const mesh = new THREE.Mesh(geometry, material.clone());
                
                // Position relative to center, shifting the whole grid so the physical center is 0,0,0
                mesh.position.set(
                    (x * voxelSpacing) + offset - centerShift, 
                    (y * voxelSpacing) + offset - centerShift, 
                    (z * voxelSpacing) + offset - centerShift  
                );
                
                cubeGroup.add(mesh);
                voxels[x][y][z] = mesh;
            }
        }
    }
    
    // Wireframe Box Outline (Centered)
    const boxSize = CUBE_SIZE * voxelSpacing;
    const boxGeo = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
    const edges = new THREE.EdgesGeometry(boxGeo);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x334155 }));
    cubeGroup.add(line);
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
        if (data.voxels && data.voxels.length === CUBE_SIZE * CUBE_SIZE * CUBE_SIZE * 3) {
            updateVoxels(data.voxels);
        }
    };

    ws.onclose = () => {
        console.log("WebSocket disconnected. Reconnecting...");
        setTimeout(connectWebSocket, 2000); // Auto reconnect
    };
};

// Map flattened 1D array to our 3D Three.JS meshes
const updateVoxels = (flatArray) => {
    let activeCount = 0;
    let powerEstimate = 0; 
    
    for (let x = 0; x < CUBE_SIZE; x++) {
        for (let y = 0; y < CUBE_SIZE; y++) {
            for (let z = 0; z < CUBE_SIZE; z++) {
                // The flat array indexing matches Python's numpy flatten() order: x, then y, then z
                const idx = (x * CUBE_SIZE * CUBE_SIZE + y * CUBE_SIZE + z) * 3;
                
                // These values arrive pre-scaled by the Python backend's brightness setting
                const r = flatArray[idx] / 255.0;
                const g = flatArray[idx+1] / 255.0;
                const b = flatArray[idx+2] / 255.0;
                
                const mesh = voxels[x][y][z];
                
                if (r > 0 || g > 0 || b > 0) {
                    mesh.material.color.setRGB(r, g, b);
                    
                    // THE FIX: Dynamically adjust opacity based on color intensity
                    // Dim colors become highly transparent; bright colors become solid.
                    const maxIntensity = Math.max(r, g, b);
                    mesh.material.opacity = 0.15 + (maxIntensity * 0.75); 
                    
                    activeCount++;
                    // Power drops naturally because r,g,b are lower numbers when dimmed
                    powerEstimate += (r + g + b) * 20; 
                } else {
                    mesh.material.color.setHex(0x111111);
                    mesh.material.opacity = 0.05; 
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
        if (isStreaming) return; 
        
        selectedMode = btn.dataset.mode;
        
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

const autoRenderToggle = document.getElementById('auto-render-toggle');
let autoRenderTimeout = null;

const triggerAutoRender = () => {
    // Only trigger if the toggle exists and is checked
    if (autoRenderToggle && autoRenderToggle.checked) {
        clearTimeout(autoRenderTimeout);
        autoRenderTimeout = setTimeout(() => {
            document.getElementById('btn-update').click();
        }, 400); 
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
    
    row.querySelector('.btn-remove').addEventListener('click', () => {
        if (container.children.length > 1) {
            row.remove();
            triggerAutoRender();
        }
    });
    
    row.querySelector('.eq-input').addEventListener('input', triggerAutoRender);
    row.querySelector('.eq-color').addEventListener('input', triggerAutoRender);
    
    container.appendChild(row);
    eqCount++;
};

// Initial default rows
addEquationRow("z = sin(sqrt(x**2 + y**2) - t)");

btnAddEq.addEventListener('click', () => addEquationRow());

// UI Wiring: Brightness Slider (Moved to a safe scope)
const brightnessSlider = document.getElementById('brightness-slider');
const brightLabel = document.getElementById('bright-label');

if (brightnessSlider && brightLabel) {
    brightnessSlider.addEventListener('input', (e) => {
        brightLabel.innerText = e.target.value;
        triggerAutoRender();
    });
}

// Playback Controls
const btnPlayPause = document.getElementById('btn-play-pause');
const tScrubber = document.getElementById('t-scrubber');
const speedSlider = document.getElementById('speed-slider');
const speedLabel = document.getElementById('speed-label');
const tValDisplay = document.getElementById('t-val-display');
let isPlaying = true;
let isScrubbing = false;

setInterval(async () => {
    if (!isScrubbing && isPlaying) {
        try {
            const res = await fetch('/api/update_time', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}) 
            });
            const data = await res.json();
            tScrubber.value = data.t % 100; 
            if(tValDisplay) tValDisplay.innerText = data.t.toFixed(1);
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
    if(tValDisplay) tValDisplay.innerText = newT.toFixed(1);
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

// UI Wiring: Main Update Button (Fixed fetch payload)
btnUpdate.addEventListener('click', async () => {
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
    
    // Grab bounds and brightness at the exact moment the button is clicked
    const minInput = document.getElementById('coord-min');
    const maxInput = document.getElementById('coord-max');
    
    // Default to the -3.5 to 3.5 "Holy Grail" values if inputs are missing
    const cMin = minInput ? parseFloat(minInput.value) : -3.5;
    const cMax = maxInput ? parseFloat(maxInput.value) : 3.5;
    const brightVal = brightnessSlider ? parseFloat(brightnessSlider.value) / 100.0 : 0.2;

    try {
        await fetch('/api/update_plot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                equations: eqArray, 
                colors: colorArray,
                coord_min: cMin,
                coord_max: cMax,
                brightness: brightVal
            })
        });
        cubeGroup.rotation.y = 0; 
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
setTimeout(() => btnUpdate.click(), 500);