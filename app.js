// DOM Elements
const video = document.getElementById('webcam');
const drawingCanvas = document.getElementById('drawing-canvas');
const handsCanvas = document.getElementById('hands-canvas');
const colorPicker = document.getElementById('color-picker');
const cameraSelect = document.getElementById('camera-select');
const clearButton = document.getElementById('clear-button');
const saveButton = document.getElementById('save-button');

// Track current media stream to stop it when switching cameras
let currentStream = null;

// Canvas contexts
const drawingCtx = drawingCanvas.getContext('2d');
const handsCtx = handsCanvas.getContext('2d');

// Drawing state
let isDrawing = false;
let isErasing = false;
let prevX = 0;
let prevY = 0;

// Debug mode (helps visualize metrics)
const DEBUG = false;

// Gesture Recognition state
let indexFingerTip = null;
let handPose = null;
let handMetrics = null;

// Initialize canvas size
function setupCanvas() {
    drawingCanvas.width = video.videoWidth || window.innerWidth;
    drawingCanvas.height = video.videoHeight || window.innerHeight;
    handsCanvas.width = video.videoWidth || window.innerWidth;
    handsCanvas.height = video.videoHeight || window.innerHeight;
}

// Get list of available cameras
async function getCameras() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        return videoDevices;
    } catch (err) {
        console.error('Error getting cameras:', err);
        return [];
    }
}

// Populate camera select dropdown
async function populateCameraOptions() {
    const cameras = await getCameras();
    
    // Clear existing options
    cameraSelect.innerHTML = '';
    
    if (cameras.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.text = 'No cameras found';
        cameraSelect.appendChild(option);
        return;
    }
    
    // Add all available cameras
    cameras.forEach(camera => {
        const option = document.createElement('option');
        option.value = camera.deviceId;
        
        // Create a more user-friendly label
        const label = camera.label || `Camera ${cameraSelect.length + 1}`;
        option.text = label;
        
        // Check if it's the front-facing camera
        if (label.toLowerCase().includes('front')) {
            option.selected = true;
        }
        
        cameraSelect.appendChild(option);
    });
}

// Initialize webcam
async function setupCamera(deviceId = null) {
    // Stop any existing stream
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
    }
    
    // Set up constraints based on selected camera
    const constraints = {
        video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 }
        }
    };
    
    // If deviceId is provided, use it
    if (deviceId) {
        constraints.video.deviceId = { exact: deviceId };
    } else {
        constraints.video.facingMode = 'user'; // Default to front camera
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        currentStream = stream;
        
        return new Promise((resolve) => {
            video.onloadedmetadata = () => {
                setupCanvas();
                resolve(video);
            };
        });
    } catch (err) {
        console.error('Error accessing webcam:', err);
        alert('Error accessing webcam. Please make sure you have granted camera permission.');
    }
}

// MediaPipe camera controller
let cameraController = null;

// Initialize MediaPipe Hands
function setupHands() {
    // If there's an existing camera controller, stop it
    if (cameraController) {
        cameraController.stop();
    }
    
    const hands = new Hands({
        locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
    });

    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });

    hands.onResults(onHandResults);

    // Start camera and detect hands
    cameraController = new Camera(video, {
        onFrame: async () => {
            await hands.send({ image: video });
        },
        width: 1280,
        height: 720
    });

    cameraController.start();
}

// Calculate palm size and depth
function calculateHandMetrics(landmarks) {
    // Calculate the palm width (distance between pinky MCP and index MCP)
    const pinkyMCP = landmarks[17]; // Pinky MCP joint
    const indexMCP = landmarks[5];  // Index MCP joint
    
    const dx = (pinkyMCP.x - indexMCP.x) * handsCanvas.width;
    const dy = (pinkyMCP.y - indexMCP.y) * handsCanvas.height;
    
    // Euclidean distance for palm width
    const palmWidth = Math.sqrt(dx * dx + dy * dy);
    
    // Calculate palm size (area of the palm - approximated as distance from wrist to middle MCP)
    const wrist = landmarks[0];
    const middleMCP = landmarks[9];
    
    const palmX = (middleMCP.x - wrist.x) * handsCanvas.width;
    const palmY = (middleMCP.y - wrist.y) * handsCanvas.height;
    
    const palmHeight = Math.sqrt(palmX * palmX + palmY * palmY);
    
    // Calculate total hand size (wrist to middle finger tip)
    const middleTip = landmarks[12];
    const handX = (middleTip.x - wrist.x) * handsCanvas.width;
    const handY = (middleTip.y - wrist.y) * handsCanvas.height;
    
    const handLength = Math.sqrt(handX * handX + handY * handY);
    
    // Use the palm area to determine overall hand size metric
    const palmSize = palmWidth * palmHeight;
    
    // Calculate a normalized depth value (0-1)
    // We'll use the palm size relative to the canvas area as a depth indicator
    // Bigger size = closer to camera
    const canvasArea = handsCanvas.width * handsCanvas.height;
    const relativePalmSize = palmSize / canvasArea;
    
    // Apply a scaling factor and clamp between 0-1
    const depthScalingFactor = 50000; // Adjust this based on typical palm sizes
    const depth = Math.min(Math.max(relativePalmSize * depthScalingFactor, 0), 1);
    
    return {
        palmWidth: palmWidth,
        palmHeight: palmHeight,
        handLength: handLength,
        palmSize: palmSize,
        depth: depth
    };
}

// Get dynamic brush size based on hand metrics - scaled directly from palm width
function getBrushSize(metrics) {
    if (!metrics) return 10; // Default fallback
    
    // Scale the brush size to be a fraction of the palm width
    // Small enough to write with precision using the finger tip
    return metrics.palmWidth * 0.4;
}

// Get eraser size based on palm width
function getEraserSize(metrics) {
    if (!metrics) return 50; // Default fallback
    
    // Make eraser approximately the size of the palm
    // Use 1.5x the width between pinky and index MCP
    return metrics.palmWidth * 1.5;
}

// Draw pointer or eraser circle based on hand position
function drawPointer(x, y, isEraser, size) {
    handsCtx.beginPath();
    
    if (isEraser) {
        handsCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
        handsCtx.fillStyle = 'rgba(255, 0, 0, 0.3)';
    } else {
        handsCtx.strokeStyle = colorPicker.value;
        handsCtx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    }
    
    handsCtx.lineWidth = 2;
    handsCtx.arc(x, y, size / 2, 0, Math.PI * 2);
    handsCtx.fill();
    handsCtx.stroke();
    
    // Draw debug info if needed
    if (DEBUG && handMetrics) {
        handsCtx.font = '14px Arial';
        handsCtx.fillStyle = 'white';
        handsCtx.fillText(`Depth: ${handMetrics.depth.toFixed(3)}`, 20, 30);
        handsCtx.fillText(`Palm Width: ${handMetrics.palmWidth.toFixed(0)}px`, 20, 50);
        handsCtx.fillText(`Palm Size: ${handMetrics.palmSize.toFixed(0)}px²`, 20, 70);
        handsCtx.fillText(`Brush Size: ${size.toFixed(1)}px`, 20, 90);
    }
}

// Handle hand detection results
function onHandResults(results) {
    // Clear hand canvas
    handsCtx.clearRect(0, 0, handsCanvas.width, handsCanvas.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        
        // Draw hand landmarks
        drawConnectors(handsCtx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
        drawLandmarks(handsCtx, landmarks, { color: '#FF0000', lineWidth: 1, radius: 3 });
        
        // Calculate hand metrics (palm size and depth)
        handMetrics = calculateHandMetrics(landmarks);
        
        // Get index finger tip position (landmark 8)
        indexFingerTip = landmarks[8];
        
        // Detect hand gestures
        detectGestures(landmarks);
        
        // Handle drawing if index finger is pointing
        if (handPose === 'index_finger' && indexFingerTip) {
            const x = indexFingerTip.x * handsCanvas.width;
            const y = indexFingerTip.y * handsCanvas.height;
            
            // Calculate brush size based on hand metrics
            const dynamicBrushSize = getBrushSize(handMetrics);
            
            // Draw pointer circle
            drawPointer(x, y, false, dynamicBrushSize);
            
            if (!isDrawing) {
                // Start drawing - move to position
                prevX = x;
                prevY = y;
                isDrawing = true;
                isErasing = false;
            } else {
                // Continue drawing - draw line
                drawLine(prevX, prevY, x, y, dynamicBrushSize);
                prevX = x;
                prevY = y;
            }
        } else if (handPose === 'open_hand') {
            // Get palm center (roughly landmark 9 - middle finger MCP)
            const palmCenter = landmarks[9];
            const x = palmCenter.x * handsCanvas.width;
            const y = palmCenter.y * handsCanvas.height;
            
            // Calculate eraser size based on palm
            const eraserSize = getEraserSize(handMetrics);
            
            // Draw eraser circle
            drawPointer(x, y, true, eraserSize);
            
            if (!isErasing) {
                // Start erasing - move to position
                prevX = x;
                prevY = y;
                isErasing = true;
                isDrawing = false;
            } else {
                // Continue erasing - use palm-sized eraser
                erase(prevX, prevY, x, y, eraserSize);
                prevX = x;
                prevY = y;
            }
        } else {
            // Stop drawing/erasing
            isDrawing = false;
            isErasing = false;
        }
    } else {
        // No hands detected
        isDrawing = false;
        isErasing = false;
        indexFingerTip = null;
    }
}

// Detect specific hand gestures
function detectGestures(landmarks) {
    // Get key finger landmarks
    const indexTip = landmarks[8];
    const indexDip = landmarks[7];
    const middleTip = landmarks[12];
    const ringTip = landmarks[16];
    const pinkyTip = landmarks[20];
    
    // Calculate if fingers are extended
    const indexExtended = indexTip.y < indexDip.y;
    const middleExtended = middleTip.y < landmarks[11].y;
    const ringExtended = ringTip.y < landmarks[15].y;
    const pinkyExtended = pinkyTip.y < landmarks[19].y;
    
    // Check for index finger pointing
    if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
        handPose = 'index_finger';
        return;
    }
    
    // Check for open hand
    if (indexExtended && middleExtended && ringExtended && pinkyExtended) {
        handPose = 'open_hand';
        return;
    }
    
    // Default - no recognized gesture
    handPose = null;
}

// Draw a line between two points
function drawLine(x1, y1, x2, y2, lineWidth) {
    drawingCtx.beginPath();
    drawingCtx.moveTo(x1, y1);
    drawingCtx.lineTo(x2, y2);
    drawingCtx.strokeStyle = colorPicker.value;
    drawingCtx.lineWidth = lineWidth;
    drawingCtx.lineCap = 'round';
    drawingCtx.stroke();
}

// Erase by drawing with composite operation
function erase(x1, y1, x2, y2, eraserSize) {
    drawingCtx.globalCompositeOperation = 'destination-out';
    drawingCtx.beginPath();
    drawingCtx.moveTo(x1, y1);
    drawingCtx.lineTo(x2, y2);
    drawingCtx.strokeStyle = 'rgba(0, 0, 0, 1)';
    drawingCtx.lineWidth = eraserSize;
    drawingCtx.lineCap = 'round';
    drawingCtx.stroke();
    drawingCtx.globalCompositeOperation = 'source-over';
}

// Clear the canvas
function clearCanvas() {
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
}

// Save the drawing
function saveDrawing() {
    const link = document.createElement('a');
    link.download = 'hand-gesture-drawing.png';
    link.href = drawingCanvas.toDataURL();
    link.click();
}

// Event listeners
window.addEventListener('resize', setupCanvas);

clearButton.addEventListener('click', clearCanvas);
saveButton.addEventListener('click', saveDrawing);

// Handle camera selection change
cameraSelect.addEventListener('change', async () => {
    const deviceId = cameraSelect.value;
    if (deviceId) {
        // Stop current MediaPipe instance
        await setupCamera(deviceId);
        setupHands();
    }
});

// Initialize the application
async function init() {
    // Request camera permissions and populate dropdown
    try {
        // First access webcam to trigger permissions prompt
        await navigator.mediaDevices.getUserMedia({ video: true });
        await populateCameraOptions();
        
        // Setup with selected camera (or default if none selected)
        const selectedCameraId = cameraSelect.value;
        await setupCamera(selectedCameraId);
        setupHands();
    } catch (err) {
        console.error('Error initializing:', err);
        alert('Error accessing webcam. Please make sure you have granted camera permission.');
    }
}

// Start everything when the page is loaded
window.addEventListener('load', init);
