// 3D Visualizer Setup
const CUBE_SIZE = 16;
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

// Create the 16x16x16 grid of spheres (representing LEDs in tubes)
const createVoxelGrid = () => {
    // Basic material (will be updated via WebSocket)
    const geometry = new THREE.SphereGeometry(0.35, 16, 16);
    const material = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.1 });

    const offset = (CUBE_SIZE - 1) * voxelSpacing / 2;

    for (let x = 0; x < CUBE_SIZE; x++) {
        voxels[x] = [];
        for (let y = 0; y < CUBE_SIZE; y++) {
            voxels[x][y] = [];
            for (let z = 0; z < CUBE_SIZE; z++) {
                const mesh = new THREE.Mesh(geometry, material.clone());
                
                // Position relative to center
                mesh.position.set(
                    (x * voxelSpacing) - offset,
                    (z * voxelSpacing) - offset, // Y in three.js is UP, but our data has Z as UP
                    (y * voxelSpacing) - offset  // So mapping y(data)->z(three) and z(data)->y(three)
                );
                
                cubeGroup.add(mesh);
                voxels[x][y][z] = mesh;
            }
        }
    }
    
    // Wireframe Box Outline
    const boxGeo = new THREE.BoxGeometry(
        CUBE_SIZE * voxelSpacing, 
        CUBE_SIZE * voxelSpacing, 
        CUBE_SIZE * voxelSpacing
    );
    const edges = new THREE.EdgesGeometry(boxGeo);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x334155 }));
    cubeGroup.add(line);
};

createVoxelGrid();

camera.position.set(25, 20, 25);
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
const eqInput = document.getElementById('equation');
const ipInput = document.getElementById('esp_ip');
let isStreaming = false;

btnUpdate.addEventListener('click', async () => {
    const eq = eqInput.value;
    const ip = ipInput.value;
    
    try {
        await fetch('/api/update_plot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ equation: eq, esp32_ip: ip })
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
