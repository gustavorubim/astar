// Grid settings
const GRID_ROWS = 50;
const GRID_COLS = 100;

class PriorityQueue {
    constructor() {
        this.values = [];
    }

    enqueue(element, priority) {
        this.values.push({ element, priority });
        this.sort();
    }

    dequeue() {
        return this.values.shift();
    }

    sort() {
        this.values.sort((a, b) => a.priority - b.priority);
    }
}

class AStarNode {
    constructor(lat, lng, row, col) {
        this.lat = lat;
        this.lng = lng;
        this.row = row;
        this.col = col;
        this.index = row * GRID_COLS + col;
        this.g = Infinity;  // Cost from start to this node
        this.h = 0;        // Heuristic (estimated cost to end)
        this.f = Infinity; // Total cost (g + h)
        this.parent = null;
        this.isWall = false;
    }
}

class AStarPathfinder {
    constructor(grid, startPos, endPos, visualCallback) {
        this.grid = grid;
        this.startPos = startPos;
        this.endPos = endPos;
        this.visualCallback = visualCallback;
        this.openSet = new PriorityQueue();
        this.closedSet = new Set();
        this.paused = false;
        this.speed = 5;
    }

    async findPath() {
        console.log('Starting pathfinding...', {
            start: this.startPos,
            end: this.endPos
        });

        const startNode = this.grid[this.startPos.row][this.startPos.col];
        const endNode = this.grid[this.endPos.row][this.endPos.col];

        startNode.g = 0;
        startNode.h = this.heuristic(startNode, endNode);
        startNode.f = startNode.h;

        this.openSet.enqueue(startNode, startNode.f);
        let nodesExplored = 0;

        while (this.openSet.values.length > 0) {
            if (this.paused) {
                await new Promise(resolve => setTimeout(resolve, 100));
                continue;
            }

            const current = this.openSet.dequeue().element;
            nodesExplored++;

            if (current === endNode) {
                console.log('Path found!', { nodesExplored });
                return {
                    path: this.reconstructPath(endNode),
                    nodesExplored
                };
            }

            this.closedSet.add(current);

            const neighbors = this.getNeighbors(current);
            for (const neighbor of neighbors) {
                if (this.closedSet.has(neighbor) || neighbor.isWall) {
                    continue;
                }

                const tentativeG = current.g + this.distance(current, neighbor);

                if (tentativeG < neighbor.g) {
                    neighbor.parent = current;
                    neighbor.g = tentativeG;
                    neighbor.h = this.heuristic(neighbor, endNode);
                    neighbor.f = neighbor.g + neighbor.h;

                    if (!this.openSet.values.some(v => v.element === neighbor)) {
                        this.openSet.enqueue(neighbor, neighbor.f);
                    }
                }
            }

            if (this.visualCallback) {
                this.visualCallback({
                    current,
                    openSet: this.openSet.values.map(v => v.element),
                    closedSet: Array.from(this.closedSet),
                    nodesExplored
                });
                await new Promise(resolve => 
                    setTimeout(resolve, Math.max(1, 11 - this.speed) * 50)
                );
            }
        }

        console.log('No path found', { nodesExplored });
        return null;
    }

    getNeighbors(node) {
        const neighbors = [];
        const directions = [
            [-1, 0], [1, 0], [0, -1], [0, 1],  // Cardinals
            [-1, -1], [-1, 1], [1, -1], [1, 1]  // Diagonals
        ];

        for (const [dx, dy] of directions) {
            const newRow = node.row + dx;
            const newCol = node.col + dy;

            if (newRow >= 0 && newRow < GRID_ROWS &&
                newCol >= 0 && newCol < GRID_COLS) {
                neighbors.push(this.grid[newRow][newCol]);
            }
        }

        return neighbors;
    }

    heuristic(node, goal) {
        return this.distance(node, goal);
    }

    distance(nodeA, nodeB) {
        // Using haversine formula for geographic distance
        const R = 3959; // Earth's radius in miles
        const lat1 = nodeA.lat * Math.PI / 180;
        const lat2 = nodeB.lat * Math.PI / 180;
        const dLat = (nodeB.lat - nodeA.lat) * Math.PI / 180;
        const dLon = (nodeB.lng - nodeA.lng) * Math.PI / 180;

        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                 Math.cos(lat1) * Math.cos(lat2) *
                 Math.sin(dLon/2) * Math.sin(dLon/2);
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    reconstructPath(endNode) {
        const path = [];
        let current = endNode;

        while (current) {
            path.unshift(current);
            current = current.parent;
        }

        return path;
    }

    setSpeed(speed) {
        this.speed = speed;
    }

    setPaused(paused) {
        this.paused = paused;
    }
}

class USMapPathfinder {
    constructor() {
        console.log('Initializing US Map Pathfinder...');
        this.map = null;
        this.debug = true;
        this.currentBox = null;
        this.startMarker = null;
        this.endMarker = null;
        this.grid = [];
        this.gridLayer = null;
        this.selectMode = 'start';
        this.isSearching = false;
        this.searchSpeed = 5;
        this.nodesExplored = 0;

        // US boundary box
        this.usBounds = {
            north: 49.384358,
            south: 24.396308,
            east: -66.934570,
            west: -125.000000
        };

        this.initialize();
    }

    log(message, data = null) {
        if (this.debug) {
            console.log(`[USMapPathfinder] ${message}`, data || '');
        }
    }

    initialize() {
        try {
            this.log('Creating map instance...');
            this.map = L.map('map-container', {
                center: [39.8283, -98.5795],
                zoom: 4,
                minZoom: 3,
                maxZoom: 18
            });

            this.log('Adding tile layer...');
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 18
            }).addTo(this.map);

            this.log('Setting up event listeners...');
            this.setupEventListeners();

            this.map.whenReady(() => {
                this.log('Map is ready');
                this.enableControls();
            });

        } catch (error) {
            this.log('Error in initialization:', error);
            document.getElementById('status').textContent = 'Failed to initialize map';
        }
    }

    setupEventListeners() {
        try {
            const elements = {
                randomLocation: document.getElementById('randomLocation'),
                clearPoints: document.getElementById('clearPoints'),
                startSearch: document.getElementById('startSearch'),
                pauseSearch: document.getElementById('pauseSearch'),
                selectMode: document.getElementById('selectMode'),
                speedControl: document.getElementById('speedControl')
            };

            if (!Object.values(elements).every(el => el)) {
                throw new Error('Required DOM elements not found');
            }

            elements.randomLocation.addEventListener('click', 
                () => this.generateRandomLocation());
            elements.clearPoints.addEventListener('click', 
                () => this.clearPoints());
            elements.startSearch.addEventListener('click', 
                () => this.startPathfinding());
            elements.pauseSearch.addEventListener('click', 
                () => this.togglePause());
            elements.selectMode.addEventListener('change', 
                (e) => this.selectMode = e.target.value);
            elements.speedControl.addEventListener('input', 
                (e) => this.searchSpeed = parseInt(e.target.value));

            this.map.on('click', (e) => this.handleMapClick(e));
            this.log('Event listeners set up successfully');

        } catch (error) {
            this.log('Error setting up event listeners:', error);
            document.getElementById('status').textContent = 'Error setting up controls';
        }
    }

    enableControls() {
        const controls = [
            'randomLocation', 'clearPoints', 'selectMode',
            'startSearch', 'speedControl'
        ];
        controls.forEach(id => {
            const element = document.getElementById(id);
            if (element) element.disabled = false;
        });
        document.getElementById('status').textContent = 'Map ready - Generate or select a location';
    }

    generateRandomLocation() {
        try {
            this.log('Generating random location...');
            
            const lat = Math.random() * (this.usBounds.north - this.usBounds.south) + this.usBounds.south;
            const lng = Math.random() * (this.usBounds.east - this.usBounds.west) + this.usBounds.west;
            
            this.clearPoints();
            this.createBoundingBox(lat, lng);
            
            document.getElementById('status').textContent = 
                `Location selected: ${lat.toFixed(4)}°N, ${lng.toFixed(4)}°W`;

        } catch (error) {
            this.log('Error generating location:', error);
            document.getElementById('status').textContent = 'Error generating location';
        }
    }

    createBoundingBox(lat, lng) {
        try {
            this.log('Creating bounding box:', { lat, lng });
            
            if (this.currentBox) this.currentBox.remove();
            if (this.gridLayer) this.gridLayer.remove();

            const MILES_TO_KM = 1.60934;
            const KM_PER_DEGREE_LAT = 111.32;
            const KM_PER_DEGREE_LNG = 111.32 * Math.cos(lat * (Math.PI / 180));

            const widthKm = 10 * MILES_TO_KM;
            const heightKm = 20 * MILES_TO_KM;

            const latOffset = heightKm / (2 * KM_PER_DEGREE_LAT);
            const lngOffset = widthKm / (2 * KM_PER_DEGREE_LNG);

            const bounds = [
                [lat + latOffset, lng - lngOffset],
                [lat + latOffset, lng + lngOffset],
                [lat - latOffset, lng + lngOffset],
                [lat - latOffset, lng - lngOffset],
                [lat + latOffset, lng - lngOffset]
            ];

            this.currentBox = L.polygon(bounds, {
                color: '#f44336',
                weight: 2,
                fillColor: '#f44336',
                fillOpacity: 0.1,
                dashArray: '5, 5'
            }).addTo(this.map);

            this.map.fitBounds(this.currentBox.getBounds(), {
                padding: [50, 50],
                maxZoom: 13
            });

            this.generateGrid(this.currentBox.getBounds());
            this.log('Bounding box created successfully');

        } catch (error) {
            this.log('Error creating bounding box:', error);
            document.getElementById('status').textContent = 'Error creating area selection';
        }
    }

    generateGrid(bounds) {
        this.log('Generating grid...');
        const gridData = [];
        const [[south, west], [north, east]] = [
            [bounds.getSouth(), bounds.getWest()],
            [bounds.getNorth(), bounds.getEast()]
        ];

        const latStep = (north - south) / GRID_ROWS;
        const lngStep = (east - west) / GRID_COLS;

        for (let row = 0; row < GRID_ROWS; row++) {
            const gridRow = [];
            for (let col = 0; col < GRID_COLS; col++) {
                const lat = south + (row * latStep);
                const lng = west + (col * lngStep);
                gridRow.push(new AStarNode(lat, lng, row, col));
            }
            gridData.push(gridRow);
        }

        this.grid = gridData;
        this.visualizeGrid();
        this.log('Grid generated successfully');
    }

    visualizeGrid() {
        if (this.gridLayer) this.gridLayer.remove();

        this.gridLayer = L.layerGroup().addTo(this.map);
        const bounds = this.currentBox.getBounds();
        
        for (let row = 0; row < this.grid.length; row++) {
            for (let col = 0; col < this.grid[row].length; col++) {
                const node = this.grid[row][col];
                const nodeBounds = [
                    [node.lat, node.lng],
                    [node.lat + (bounds.getNorth() - bounds.getSouth()) / GRID_ROWS,
                     node.lng + (bounds.getEast() - bounds.getWest()) / GRID_COLS]
                ];
                
                L.rectangle(nodeBounds, {
                    color: '#fff',
                    weight: 1,
                    fillOpacity: 0,
                    opacity: 0.2
                }).addTo(this.gridLayer);
            }
        }
    }

    handleMapClick(e) {
        if (!this.currentBox) return;
        
        const bounds = this.currentBox.getBounds();
        if (!bounds.contains(e.latlng)) {
            document.getElementById('status').textContent = 'Click inside the selected area';
            return;
        }

        if (this.selectMode === 'start') {
            if (this.startMarker) this.startMarker.remove();
            this.startMarker = L.marker(e.latlng, {
                icon: L.divIcon({
                    className: 'start-marker',
                    html: '🟢',
                    iconSize: [24, 24]
                })
            }).addTo(this.map);
        } else {
            if (this.endMarker) this.endMarker.remove();
            this.endMarker = L.marker(e.latlng, {
                icon: L.divIcon({
                    className: 'end-marker',
                    html: '🔴',
                    iconSize: [24, 24]
                })
            }).addTo(this.map);
        }

        document.getElementById('startSearch').disabled = !(this.startMarker && this.endMarker);
    }

    clearPoints() {
        if (this.startMarker) this.startMarker.remove();
        if (this.endMarker) this.endMarker.remove();
        if (this.currentBox) this.currentBox.remove();
        if (this.gridLayer) this.gridLayer.remove();
        
        this.startMarker = null;
        this.endMarker = null;
        this.currentBox = null;
        this.grid = [];
        
        document.getElementById('startSearch').disabled = true;
        document.getElementById('status').textContent = 'Points cleared';
        document.getElementById('nodesExplored').textContent = 'Nodes explored: 0';
        document.getElementById('pathLength').textContent = 'Path length: 0.0 mi';
    }

    getGridPosition(latlng) {
        if (!this.currentBox || !this.grid.length) return null;

        const bounds = this.currentBox.getBounds();
        const latRange = bounds.getNorth() - bounds.getSouth();
        const lngRange = bounds.getEast() - bounds.getWest();

        const row = Math.floor(((bounds.getNorth() - latlng.lat) / latRange) * GRID_ROWS);
        const col = Math.floor(((latlng.lng - bounds.getWest()) / lngRange) * GRID_COLS);

        if (row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS) {
            return { row, col };
        }
        return null;
    }

    async startPathfinding() {
        try {
            if (!this.startMarker || !this.endMarker) {
                document.getElementById('status').textContent = 'Please select start and end points';
                return;
            }

            const startPos = this.getGridPosition(this.startMarker.getLatLng());
            const endPos = this.getGridPosition(this.endMarker.getLatLng());

            if (!startPos || !endPos) {
                document.getElementById('status').textContent = 'Invalid point positions';
                return;
            }

            this.log('Starting A* pathfinding', { startPos, endPos });
            this.isSearching = true;
            document.getElementById('startSearch').disabled = true;
            document.getElementById('pauseSearch').disabled = false;
            document.getElementById('status').textContent = 'Searching for path...';

            const pathfinder = new AStarPathfinder(
                this.grid,
                startPos,
                endPos,
                (state) => this.visualizeSearch(state)
            );

            pathfinder.setSpeed(this.searchSpeed);
            const result = await pathfinder.findPath();

            if (result) {
                this.visualizePath(result.path);
                document.getElementById('status').textContent = 'Path found!';
                document.getElementById('nodesExplored').textContent = 
                    `Nodes explored: ${result.nodesExplored}`;
                document.getElementById('pathLength').textContent = 
                    `Path length: ${this.calculatePathLength(result.path).toFixed(2)} mi`;
            } else {
                document.getElementById('status').textContent = 'No path found';
            }

        } catch (error) {
            this.log('Error in pathfinding:', error);
            document.getElementById('status').textContent = 'Error during pathfinding';
        } finally {
            this.isSearching = false;
            document.getElementById('startSearch').disabled = false;
            document.getElementById('pauseSearch').disabled = true;
            document.getElementById('pauseSearch').textContent = 'Pause';
        }
    }

    visualizeSearch(state) {
        const { current, openSet, closedSet, nodesExplored } = state;

        document.getElementById('nodesExplored').textContent = `Nodes explored: ${nodesExplored}`;

        this.gridLayer.clearLayers();

        const bounds = this.currentBox.getBounds();
        const latStep = (bounds.getNorth() - bounds.getSouth()) / GRID_ROWS;
        const lngStep = (bounds.getEast() - bounds.getWest()) / GRID_COLS;

        for (let row = 0; row < this.grid.length; row++) {
            for (let col = 0; col < this.grid[row].length; col++) {
                const node = this.grid[row][col];
                const nodeBounds = [
                    [node.lat, node.lng],
                    [node.lat + latStep, node.lng + lngStep]
                ];

                let color = 'transparent';
                let opacity = 0;

                if (closedSet.includes(node)) {
                    color = '#9C27B0';
                    opacity = 0.3;
                } else if (openSet.includes(node)) {
                    color = '#2196F3';
                    opacity = 0.3;
                }

                if (node === current) {
                    color = '#FFC107';
                    opacity = 0.5;
                }

                L.rectangle(nodeBounds, {
                    color: '#fff',
                    weight: 1,
                    fillColor: color,
                    fillOpacity: opacity,
                    opacity: 0.2
                }).addTo(this.gridLayer);
            }
        }
    }

    visualizePath(path) {
        const pathCoords = path.map(node => [node.lat, node.lng]);
        L.polyline(pathCoords, {
            color: '#4CAF50',
            weight: 4,
            opacity: 0.8
        }).addTo(this.gridLayer);
    }

    calculatePathLength(path) {
        let length = 0;
        for (let i = 1; i < path.length; i++) {
            const node1 = path[i - 1];
            const node2 = path[i];
            
            const R = 3959; // Earth's radius in miles
            const lat1 = node1.lat * Math.PI / 180;
            const lat2 = node2.lat * Math.PI / 180;
            const dLat = (node2.lat - node1.lat) * Math.PI / 180;
            const dLon = (node2.lng - node1.lng) * Math.PI / 180;

            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                     Math.cos(lat1) * Math.cos(lat2) *
                     Math.sin(dLon/2) * Math.sin(dLon/2);
            
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            length += R * c;
        }
        return length;
    }

    togglePause() {
        const button = document.getElementById('pauseSearch');
        if (this.isSearching) {
            button.textContent = 'Resume';
            this.isSearching = false;
        } else {
            button.textContent = 'Pause';
            this.isSearching = true;
        }
    }
}

// Initialize the application
console.log('Starting application initialization...');
window.addEventListener('load', () => {
    try {
        new USMapPathfinder();
    } catch (error) {
        console.error('Failed to start application:', error);
        document.getElementById('status').textContent = 'Failed to start application';
    }
});