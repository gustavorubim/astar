class PathfindingVisualizer {
    constructor() {
        this.map = null;
        this.debug = true;
        this.roadNetwork = new RoadNetwork();
        this.pathfinder = new RoadPathfinder(this.roadNetwork);
        this.startMarker = null;
        this.endMarker = null;
        this.roadLayer = null;
        this.searchLayer = null;
        this.pathLayer = null;
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
            console.log(`[PathfindingVisualizer] ${message}`, data || '');
        }
    }

    initialize() {
        try {
            const mapContainer = document.getElementById('map-container');
            if (!mapContainer) {
                throw new Error('Map container not found');
            }

            this.log('Creating map instance...');
            this.map = L.map('map-container', {
                center: [39.8283, -98.5795],
                zoom: 4,
                minZoom: 3,
                maxZoom: 18,
                zoomControl: true,
                attributionControl: true
            });

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 18
            }).addTo(this.map);

            // Create layers
            this.roadLayer = L.layerGroup().addTo(this.map);
            this.searchLayer = L.layerGroup().addTo(this.map);
            this.pathLayer = L.layerGroup().addTo(this.map);

            this.setupEventListeners();
            this.pathfinder.setVisualizationCallback((state) => this.visualizeSearch(state));

            this.map.whenReady(() => {
                this.log('Map is ready');
                this.enableControls();
                document.getElementById('status').textContent = 'Map ready - Click Random US Location';
            });

        } catch (error) {
            this.log('Error in initialization:', error);
            document.getElementById('status').textContent = 'Failed to initialize map: ' + error.message;
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
                speedControl: document.getElementById('speedControl'),
                areaSize: document.getElementById('areaSize')
            };

            if (!Object.values(elements).every(el => el)) {
                throw new Error('Required DOM elements not found');
            }

            elements.randomLocation.addEventListener('click', () => this.generateRandomLocation());
            elements.clearPoints.addEventListener('click', () => this.clearPoints());
            elements.startSearch.addEventListener('click', () => this.startPathfinding());
            elements.pauseSearch.addEventListener('click', () => this.togglePause());
            elements.selectMode.addEventListener('change', (e) => this.selectMode = e.target.value);
            
            // Speed control with visual feedback
            elements.speedControl.addEventListener('input', (e) => {
                this.searchSpeed = parseInt(e.target.value);
                this.pathfinder.setSpeed(this.searchSpeed);
                this.updateSpeedDisplay();
            });

            // Area size selection
            elements.areaSize.addEventListener('change', (e) => {
                this.log('Area size changed:', e.target.value);
                if (this.roadNetwork.ready) {
                    this.generateRandomLocation();
                }
            });

            this.map.on('click', (e) => this.handleMapClick(e));
            this.log('Event listeners set up successfully');

        } catch (error) {
            this.log('Error setting up event listeners:', error);
            document.getElementById('status').textContent = 'Error setting up controls';
        }
    }

    getAreaSize() {
        const sizeValues = {
            'small': 0.02,  // ~2km at equator
            'medium': 0.05, // ~5km at equator
            'large': 0.1    // ~10km at equator
        };
        const areaSelect = document.getElementById('areaSize');
        return sizeValues[areaSelect.value] || sizeValues.medium;
    }

    updateSpeedDisplay() {
        const speedLabels = {
            1: 'Very Slow',
            2: 'Slow',
            3: 'Slow+',
            4: 'Normal-',
            5: 'Normal',
            6: 'Normal+',
            7: 'Fast-',
            8: 'Fast',
            9: 'Fast+',
            10: 'Very Fast'
        };
        const speedValue = document.getElementById('speedValue');
        if (speedValue) {
            speedValue.textContent = speedLabels[this.searchSpeed] || 'Normal';
        }
    }

    enableControls() {
        const controls = [
            'randomLocation', 'selectMode', 'areaSize', 'speedControl'
        ];
        controls.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.disabled = false;
                if (id === 'speedControl') {
                    this.updateSpeedDisplay();
                }
            }
        });
    }

    async generateRandomLocation() {
        try {
            this.log('Generating random location...');
            this.clearPoints();
            
            const lat = Math.random() * (this.usBounds.north - this.usBounds.south) + this.usBounds.south;
            const lng = Math.random() * (this.usBounds.east - this.usBounds.west) + this.usBounds.west;
            
            // Get area size from selector
            const boxSize = this.getAreaSize();
            
            // Adjust for longitude distortion based on latitude
            const lngScale = Math.cos(lat * Math.PI / 180);
            const bounds = {
                south: lat - boxSize,
                north: lat + boxSize,
                west: lng - boxSize / lngScale,
                east: lng + boxSize / lngScale
            };

            document.getElementById('status').textContent = 'Fetching road data...';
            const success = await this.roadNetwork.fetchRoadData(bounds);
            
            if (success) {
                this.visualizeRoadNetwork();
                this.map.fitBounds([
                    [bounds.south, bounds.west],
                    [bounds.north, bounds.east]
                ], { padding: [50, 50] });
                
                // Enable speed control and update display
                document.getElementById('speedControl').disabled = false;
                this.updateSpeedDisplay();
                
                document.getElementById('status').textContent =
                    'Road network loaded - Select start and end points';
            } else {
                document.getElementById('status').textContent =
                    'Failed to load road data - Try a different location';
            }

        } catch (error) {
            this.log('Error generating location:', error);
            document.getElementById('status').textContent = 'Error loading location: ' + error.message;
        }
    }

    visualizeRoadNetwork() {
        this.roadLayer.clearLayers();
        
        // Draw all road segments
        for (const edge of this.roadNetwork.edges.values()) {
            if (edge.path.length < 2) continue;

            const line = L.polyline(edge.path, {
                color: '#ffffff',
                weight: this.getRoadWeight(edge.roadType),
                opacity: 0.6,
                className: `road road-${edge.roadType}`
            }).addTo(this.roadLayer);

            // Optional: Add road name on hover
            if (edge.name) {
                line.bindTooltip(edge.name);
            }
        }
    }

    getRoadWeight(roadType) {
        const weights = {
            'motorway': 5,
            'trunk': 4,
            'primary': 3,
            'secondary': 2.5,
            'tertiary': 2,
            'residential': 1.5,
            'service': 1
        };
        return weights[roadType] || 1.5;
    }

    handleMapClick(e) {
        if (!this.roadNetwork.ready) {
            document.getElementById('status').textContent = 'Generate a location first';
            return;
        }

        const node = this.roadNetwork.findNearestNode(e.latlng.lat, e.latlng.lng);
        if (!node) {
            document.getElementById('status').textContent = 'No road found near click';
            return;
        }

        try {
            // Create marker
            const icon = L.divIcon({
                className: this.selectMode === 'start' ? 'start-marker' : 'end-marker',
                html: this.selectMode === 'start' ? '🟢' : '🔴',
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            });

            if (this.selectMode === 'start') {
                if (this.startMarker) this.startMarker.remove();
                this.startMarker = L.marker([node.lat, node.lng], { icon }).addTo(this.map);
                document.getElementById('status').textContent = 'Start point set';
            } else {
                if (this.endMarker) this.endMarker.remove();
                this.endMarker = L.marker([node.lat, node.lng], { icon }).addTo(this.map);
                document.getElementById('status').textContent = 'End point set';
            }

            const hasStartAndEnd = this.startMarker && this.endMarker;
            document.getElementById('startSearch').disabled = !hasStartAndEnd;
            document.getElementById('clearPoints').disabled = !(this.startMarker || this.endMarker);

            if (hasStartAndEnd) {
                document.getElementById('status').textContent = 'Ready to start pathfinding';
            }

        } catch (error) {
            this.log('Error in handleMapClick:', error);
            document.getElementById('status').textContent = 'Error setting point';
        }
    }

    clearPoints() {
        try {
            // Clear markers and layers
            if (this.startMarker) this.startMarker.remove();
            if (this.endMarker) this.endMarker.remove();
            this.searchLayer.clearLayers();
            this.pathLayer.clearLayers();
            
            this.startMarker = null;
            this.endMarker = null;
            
            // Reset controls state
            const elements = {
                startSearch: document.getElementById('startSearch'),
                clearPoints: document.getElementById('clearPoints'),
                speedControl: document.getElementById('speedControl'),
                speedValue: document.getElementById('speedValue'),
                status: document.getElementById('status'),
                nodesExplored: document.getElementById('nodesExplored'),
                pathLength: document.getElementById('pathLength'),
                estimatedTime: document.getElementById('estimatedTime'),
                gScore: document.getElementById('gScore'),
                hScore: document.getElementById('hScore'),
                fScore: document.getElementById('fScore')
            };

            // Update controls
            if (elements.startSearch) elements.startSearch.disabled = true;
            if (elements.clearPoints) elements.clearPoints.disabled = true;
            if (elements.speedControl) {
                elements.speedControl.value = 5; // Reset to default speed
                elements.speedControl.disabled = !this.roadNetwork.ready;
            }

            // Reset display values
            const displayUpdates = {
                status: 'Points cleared',
                nodesExplored: 'Nodes explored: 0',
                pathLength: 'Path length: 0.0 mi',
                estimatedTime: 'Est. time: 0 mins',
                gScore: '0',
                hScore: '0',
                fScore: '0',
                speedValue: 'Normal'
            };

            Object.entries(displayUpdates).forEach(([id, value]) => {
                if (elements[id]) elements[id].textContent = value;
            });

            // Reset internal state
            this.searchSpeed = 5;
            this.pathfinder.setSpeed(this.searchSpeed);
            this.isSearching = false;

        } catch (error) {
            this.log('Error in clearPoints:', error);
            document.getElementById('status').textContent = 'Error clearing points';
        }
    }

    async startPathfinding() {
        try {
            if (!this.startMarker || !this.endMarker) {
                document.getElementById('status').textContent = 'Select start and end points first';
                return;
            }

            this.searchLayer.clearLayers();
            this.pathLayer.clearLayers();
            this.isSearching = true;
            document.getElementById('startSearch').disabled = true;
            document.getElementById('pauseSearch').disabled = false;
            document.getElementById('status').textContent = 'Searching for path...';

            const result = await this.pathfinder.findPath(
                this.startMarker.getLatLng().lat,
                this.startMarker.getLatLng().lng,
                this.endMarker.getLatLng().lat,
                this.endMarker.getLatLng().lng
            );

            if (result && result.path) {
                this.visualizeFinalPath(result.path);
                document.getElementById('status').textContent = 'Path found!';
                document.getElementById('nodesExplored').textContent = 
                    `Nodes explored: ${result.nodesExplored}`;
                document.getElementById('pathLength').textContent = 
                    `Path length: ${(result.path.totalDistance * 0.000621371).toFixed(2)} mi`;
                document.getElementById('estimatedTime').textContent = 
                    `Est. time: ${Math.round(result.path.totalTime)} mins`;
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
        }
    }

    async visualizeSearch(state) {
        const { current, openSet, closedSet, scores, nodesExplored } = state;
        
        // Update metrics
        document.getElementById('nodesExplored').textContent = `Nodes explored: ${nodesExplored}`;
        document.getElementById('gScore').textContent = (scores.g * 0.000621371).toFixed(2) + ' mi';
        document.getElementById('hScore').textContent = (scores.h * 0.000621371).toFixed(2) + ' mi';
        document.getElementById('fScore').textContent = (scores.f * 0.000621371).toFixed(2) + ' mi';

        this.searchLayer.clearLayers();

        // Draw open set
        for (const node of openSet) {
            this.drawNodeConnections(node, 'road-open');
        }

        // Draw closed set
        for (const node of closedSet) {
            this.drawNodeConnections(node, 'road-closed');
        }

        // Draw current node
        if (current) {
            this.drawNodeConnections(current, 'road-current');
        }
    }

    drawNodeConnections(node, className) {
        for (const [neighborId, edge] of node.connections) {
            if (edge.path.length >= 2) {
                L.polyline(edge.path, {
                    className: `road ${className}`,
                    weight: this.getRoadWeight(edge.roadType)
                }).addTo(this.searchLayer);
            }
        }
    }

    visualizeFinalPath(pathResult) {
        // Draw the final path segments
        for (const segment of pathResult.segments) {
            L.polyline(segment.points, {
                className: 'road road-path',
                weight: this.getRoadWeight(segment.edge.roadType)
            }).addTo(this.pathLayer);
        }
    }

    togglePause() {
        const button = document.getElementById('pauseSearch');
        if (this.isSearching) {
            button.textContent = 'Resume';
            this.isSearching = false;
            this.pathfinder.setPaused(true);
        } else {
            button.textContent = 'Pause';
            this.isSearching = true;
            this.pathfinder.setPaused(false);
        }
    }
}

// Initialize the application
window.addEventListener('load', () => {
    try {
        new PathfindingVisualizer();
    } catch (error) {
        console.error('Failed to start application:', error);
        document.getElementById('status').textContent = 'Failed to start application';
    }
});