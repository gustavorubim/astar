import { AStarPathfinder } from './pathfinding.js';

// Grid settings
const GRID_ROWS = 50;
const GRID_COLS = 100;

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

class USMapPathfinder {
    constructor() {
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
            this.log('Initializing map...');
            
            // Initialize map
            this.map = L.map('map-container', {
                center: [39.8283, -98.5795],
                zoom: 4,
                minZoom: 3,
                maxZoom: 18
            });

            // Add tile layer
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 18
            }).addTo(this.map);

            this.setupEventListeners();
            this.map.whenReady(() => this.enableControls());

        } catch (error) {
            this.log('Error in initialization:', error);
            document.getElementById('status').textContent = 'Failed to initialize map';
        }
    }

    setupEventListeners() {
        try {
            // Button event listeners
            document.getElementById('randomLocation').addEventListener('click', 
                () => this.generateRandomLocation());
            document.getElementById('clearPoints').addEventListener('click', 
                () => this.clearPoints());
            document.getElementById('startSearch').addEventListener('click', 
                () => this.startPathfinding());
            document.getElementById('pauseSearch').addEventListener('click', 
                () => this.togglePause());
            
            // Control event listeners
            document.getElementById('selectMode').addEventListener('change', 
                (e) => this.selectMode = e.target.value);
            document.getElementById('speedControl').addEventListener('input', 
                (e) => this.searchSpeed = parseInt(e.target.value));

            // Map click event
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
            if (this.currentBox) this.currentBox.remove();
            if (this.gridLayer) this.gridLayer.remove();

            // Constants for conversion
            const MILES_TO_KM = 1.60934;
            const KM_PER_DEGREE_LAT = 111.32;
            const KM_PER_DEGREE_LNG = 111.32 * Math.cos(lat * (Math.PI / 180));

            // Convert 10x20 miles to kilometers
            const widthKm = 10 * MILES_TO_KM;
            const heightKm = 20 * MILES_TO_KM;

            // Calculate degree offsets
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

            // Generate grid
            this.generateGrid(this.currentBox.getBounds());

        } catch (error) {
            this.log('Error creating bounding box:', error);
            document.getElementById('status').textContent = 'Error creating area selection';
        }
    }

    generateGrid(bounds) {
        const gridData = [];
        const [[south, west], [north, east]] = [
            [bounds.getSouth(), bounds.getWest()],
            [bounds.getNorth(), bounds.getEast()]
        ];

        const latStep = (north - south) / GRID_ROWS;
        const lngStep = (east - west) / GRID_COLS;

        // Generate grid nodes
        for (let row = 0; row < GRID_ROWS; row++) {
            const gridRow = [];
            for (let col = 0; col < GRID_COLS; col++) {
                const lat = south + (row * latStep);
                const lng = west + (col * lngStep);
                gridRow.push(new AStarNode(lat, lng));
            }
            gridData.push(gridRow);
        }

        this.grid = gridData;
        this.visualizeGrid();
    }

    visualizeGrid() {
        if (this.gridLayer) this.gridLayer.remove();

        this.gridLayer = L.layerGroup().addTo(this.map);
        const bounds = this.currentBox.getBounds();
        
        for (let row = 0; row < this.grid.length; row++) {
            for (let col = 0; col < this.grid[row].length; col++) {
                const node = this.grid[row][col];
                const bounds = [
                    [node.lat, node.lng],
                    [node.lat + (bounds.getNorth() - bounds.getSouth()) / GRID_ROWS,
                     node.lng + (bounds.getEast() - bounds.getWest()) / GRID_COLS]
                ];
                
                L.rectangle(bounds, {
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

        // Update metrics
        document.getElementById('nodesExplored').textContent = `Nodes explored: ${nodesExplored}`;

        // Clear previous visualization
        this.gridLayer.clearLayers();

        // Draw grid with search state
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
        // Draw the final path
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
            
            // Haversine formula for distance
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
window.addEventListener('load', () => {
    try {
        new USMapPathfinder();
    } catch (error) {
        console.error('Failed to start application:', error);
        document.getElementById('status').textContent = 'Failed to start application';
    }
});