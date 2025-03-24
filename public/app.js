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
        this.lastLoadedBounds = null;
        this.loadingBox = null;
        this.progressBar = null;

        // US boundary box for initial view
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

            // Add scale control
            L.control.scale().addTo(this.map);

            // Add location control
            L.control.locate({
                position: 'topleft',
                locateOptions: {
                    maxZoom: 16
                }
            }).addTo(this.map);

            // Create layers
            this.roadLayer = L.layerGroup().addTo(this.map);
            this.searchLayer = L.layerGroup().addTo(this.map);
            this.pathLayer = L.layerGroup().addTo(this.map);

            this.setupEventListeners();
            this.pathfinder.setVisualizationCallback((state) => this.visualizeSearch(state));

            // Setup map move handler with debounce
            let moveTimeout;
            this.map.on('moveend', () => {
                clearTimeout(moveTimeout);
                moveTimeout = setTimeout(() => this.handleMapMoveEnd(), 500);
            });

            this.map.whenReady(() => {
                this.log('Map is ready');
                this.enableControls();
                document.getElementById('status').textContent = 'Zoom in to an area to load roads';
            });

        } catch (error) {
            this.log('Error in initialization:', error);
            document.getElementById('status').textContent = 'Failed to initialize map: ' + error.message;
        }
    }

    handleMapMoveEnd() {
        const zoom = this.map.getZoom();
        if (zoom >= 15) { // Only load roads at sufficient zoom level
            const bounds = this.map.getBounds();
            this.loadRoadsInView(bounds);
        } else {
            this.roadLayer.clearLayers();
            document.getElementById('status').textContent = 'Zoom in further to see roads';
        }
    }

    async loadRoadsInView(bounds) {
        if (this.roadNetwork.loading) {
            this.log('Already loading roads, skipping request');
            return;
        }

        try {
            // Add loading indicator to map
            if (this.loadingBox) {
                this.loadingBox.remove();
            }
            this.loadingBox = L.rectangle(bounds, {
                color: '#fff',
                weight: 1,
                fillColor: '#000',
                fillOpacity: 0.1,
                dashArray: '5,10'
            }).addTo(this.map);

            // Add progress bar
            if (!this.progressBar) {
                this.progressBar = L.control({ position: 'bottomright' });
                this.progressBar.onAdd = () => {
                    const div = L.DomUtil.create('div', 'progress-bar');
                    div.innerHTML = '<div class="progress-fill"></div>';
                    return div;
                };
                this.progressBar.addTo(this.map);
            }

            document.getElementById('status').textContent = 'Loading roads...';

            // Check bounds size to prevent loading too large an area
            const latSpan = bounds.getNorth() - bounds.getSouth();
            const lngSpan = bounds.getEast() - bounds.getWest();
            
            if (latSpan > 0.1 || lngSpan > 0.1) { // Roughly 11km
                throw new Error('Area too large - Please zoom in further');
            }

            // Start progress updates
            const progressInterval = setInterval(() => {
                const progress = this.roadNetwork.getLoadProgress();
                const fill = document.querySelector('.progress-fill');
                if (fill) {
                    fill.style.width = `${progress}%`;
                }
            }, 100);

            const success = await this.roadNetwork.fetchRoadData({
                south: bounds.getSouth(),
                north: bounds.getNorth(),
                west: bounds.getWest(),
                east: bounds.getEast()
            });

            clearInterval(progressInterval);

            if (success) {
                this.visualizeRoadNetwork();
                document.getElementById('status').textContent = 'Roads loaded - Click near roads to set points';
                
                // Store successfully loaded bounds
                this.lastLoadedBounds = bounds;
            } else {
                document.getElementById('status').textContent = 'No roads found - Try a different area';
            }

        } catch (error) {
            this.log('Error loading roads:', error);
            document.getElementById('status').textContent = 'Error: ' + error.message;
            this.roadLayer.clearLayers();
            
        } finally {
            // Clean up UI elements
            if (this.loadingBox) {
                this.loadingBox.remove();
                this.loadingBox = null;
            }
            if (this.progressBar) {
                this.map.removeControl(this.progressBar);
                this.progressBar = null;
            }
        }
    }

    setupEventListeners() {
        try {
            const elements = {
                clearPoints: document.getElementById('clearPoints'),
                startSearch: document.getElementById('startSearch'),
                pauseSearch: document.getElementById('pauseSearch'),
                selectMode: document.getElementById('selectMode'),
                speedControl: document.getElementById('speedControl')
            };

            if (!Object.values(elements).every(el => el)) {
                throw new Error('Required DOM elements not found');
            }

            elements.clearPoints.addEventListener('click', () => this.clearPoints());
            elements.startSearch.addEventListener('click', () => this.startPathfinding());
            elements.pauseSearch.addEventListener('click', () => this.togglePause());
            elements.selectMode.addEventListener('change', (e) => {
                this.selectMode = e.target.value;
                // Update status message based on current selection mode
                document.getElementById('status').textContent = 
                    this.selectMode === 'start' ? 'Click to set start point' : 'Click to set end point';
            });
            
            // Speed control with visual feedback
            elements.speedControl.addEventListener('input', (e) => {
                this.searchSpeed = parseInt(e.target.value);
                this.pathfinder.setSpeed(this.searchSpeed);
                this.updateSpeedDisplay();
            });

            // Map click handler
            this.map.on('click', (e) => this.handleMapClick(e));
            
            // Show/hide help panel based on zoom level
            this.map.on('zoomend', () => {
                const helpPanel = document.getElementById('help-panel');
                if (helpPanel) {
                    helpPanel.style.display = this.map.getZoom() < 15 ? 'block' : 'none';
                }
                
                // Update status message based on zoom level
                const status = document.getElementById('status');
                if (status) {
                    status.textContent = this.map.getZoom() < 15
                        ? 'Zoom in further to see roads and select points'
                        : 'Click near roads to set start/end points';
                }
            });

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
        // Enable controls that should be available from the start
        const controls = ['selectMode', 'speedControl'];
        controls.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.disabled = false;
                if (id === 'speedControl') {
                    this.updateSpeedDisplay();
                }
            }
        });

        // Show initial help text
        document.getElementById('status').textContent = 'Zoom in to an area to see roads';
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
        if (!this.map) {
            this.log('Error: Map not initialized');
            document.getElementById('status').textContent = 'Error: Map not initialized';
            return;
        }

        const zoom = this.map.getZoom();
        if (zoom < 15) {
            document.getElementById('status').textContent = 'Zoom in further to select points (current: ' + zoom + ', needed: 15+)';
            return;
        }

        if (this.roadNetwork.loading) {
            document.getElementById('status').textContent = 'Please wait, roads are still loading...';
            return;
        }

        const clickLocation = e.latlng;
        this.log('Map clicked:', clickLocation);

        try {
            // Show click location temporarily
            const clickMarker = L.circle([clickLocation.lat, clickLocation.lng], {
                radius: 5,
                color: '#fff',
                fillColor: '#fff',
                fillOpacity: 1,
                weight: 2
            }).addTo(this.map);
            
            setTimeout(() => clickMarker.remove(), 1000);

            // Validate road network state
            if (!this.roadNetwork.ready || this.roadNetwork.nodes.size === 0) {
                this.log('Loading roads for clicked area');
                const bounds = this.map.getBounds();
                this.loadRoadsInView(bounds);
                document.getElementById('status').textContent = 'Loading roads, please wait and try clicking again...';
                return;
            }

            // Find nearest node with debug logging
            this.log('Finding nearest node to:', clickLocation);
            const node = this.roadNetwork.findNearestNode(clickLocation.lat, clickLocation.lng);
            
            if (!node) {
                document.getElementById('status').textContent = 'No road found within 100m of click. Try clicking closer to a road.';
                // Show a temporary "no road found" indicator
                const noRoadMarker = L.circle([clickLocation.lat, clickLocation.lng], {
                    radius: 100,
                    color: '#ff0000',
                    fillColor: '#ff0000',
                    fillOpacity: 0.1,
                    weight: 1,
                    dashArray: '4'
                }).addTo(this.map);
                setTimeout(() => noRoadMarker.remove(), 2000);
                return;
            }

            this.log('Found nearest node:', node);

            // Show line from click to nearest node
            const snapLine = L.polyline([[clickLocation.lat, clickLocation.lng], [node.lat, node.lng]], {
                color: '#ffffff',
                weight: 1,
                dashArray: '4',
                opacity: 0.6
            }).addTo(this.map);
            
            setTimeout(() => snapLine.remove(), 1500);

            // Create marker
            const icon = L.divIcon({
                className: this.selectMode === 'start' ? 'start-marker' : 'end-marker',
                html: this.selectMode === 'start' ? '🟢' : '🔴',
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            });

            // Update markers
            if (this.selectMode === 'start') {
                if (this.startMarker) {
                    this.startMarker.remove();
                }
                this.startMarker = L.marker([node.lat, node.lng], { icon })
                    .addTo(this.map)
                    .bindTooltip('Start Point');
                document.getElementById('status').textContent = 'Start point set - Now select an end point';
                document.getElementById('selectMode').value = 'end';
                this.selectMode = 'end';  // Update internal state
            } else {
                if (this.endMarker) {
                    this.endMarker.remove();
                }
                this.endMarker = L.marker([node.lat, node.lng], { icon })
                    .addTo(this.map)
                    .bindTooltip('End Point');
                document.getElementById('status').textContent = 'End point set';
                // Don't auto-switch back to start mode
            }

            // Update control states
            const hasStartAndEnd = this.startMarker && this.endMarker;
            const controls = {
                startSearch: document.getElementById('startSearch'),
                clearPoints: document.getElementById('clearPoints')
            };

            if (controls.startSearch) controls.startSearch.disabled = !hasStartAndEnd;
            if (controls.clearPoints) controls.clearPoints.disabled = !(this.startMarker || this.endMarker);
            
            if (hasStartAndEnd) {
                document.getElementById('status').textContent = 'Ready to start pathfinding! Click Find Path to begin.';
            }

        } catch (error) {
            this.log('Error in handleMapClick:', error);
            document.getElementById('status').textContent = 'Error setting point: ' + error.message;
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
                status: 'Points cleared - Select a new start point',
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
            this.selectMode = 'start';
            document.getElementById('selectMode').value = 'start';

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