class MapPathfinder {
    constructor() {
        this.map = null;
        this.routeLayer = null;
        this.bboxLayer = null;
        this.osrmClient = null;
        
        // US boundary box for random location generation
        this.usBounds = {
            north: 49.384358,  // Northernmost point
            south: 24.396308,  // Southernmost point
            east: -66.934570,  // Easternmost point
            west: -125.000000  // Westernmost point
        };

        this.initialize();
    }

    initialize() {
        // Initialize map
        this.map = L.map('map-container', {
            center: [39.8283, -98.5795], // Geographic center of USA
            zoom: 4
        });

        // Add OpenStreetMap tiles
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);

        // Initialize layers for route and bounding box
        this.routeLayer = L.layerGroup().addTo(this.map);
        this.bboxLayer = L.layerGroup().addTo(this.map);

        this.setupEventListeners();
    }

    setupEventListeners() {
        const randomButton = document.getElementById('randomLocation');
        randomButton.addEventListener('click', () => this.generateRandomLocation());

        const routeSelect = document.getElementById('routeType');
        routeSelect.addEventListener('change', () => {
            if (this.currentLocation) {
                this.updateRouteDisplay();
            }
        });
    }

    generateRandomLocation() {
        // Generate random coordinates within US bounds
        const lat = Math.random() * (this.usBounds.north - this.usBounds.south) + this.usBounds.south;
        const lng = Math.random() * (this.usBounds.east - this.usBounds.west) + this.usBounds.west;
        
        this.currentLocation = [lat, lng];
        this.updateMapView();
    }

    updateMapView() {
        // Clear previous layers
        this.routeLayer.clearLayers();
        this.bboxLayer.clearLayers();

        // Create 10x20 mile bounding box
        const bbox = this.createBoundingBox(this.currentLocation[0], this.currentLocation[1], 10, 20);
        
        // Draw bounding box
        const bboxPolygon = L.polygon([
            [bbox.north, bbox.west],
            [bbox.north, bbox.east],
            [bbox.south, bbox.east],
            [bbox.south, bbox.west]
        ], {
            color: '#f44336',
            weight: 2,
            fillOpacity: 0,
            dashArray: '5, 5'
        }).addTo(this.bboxLayer);

        // Update map view
        this.map.fitBounds(bboxPolygon.getBounds(), {
            padding: [50, 50]
        });

        // Update coordinate display
        document.getElementById('coordinates').textContent = 
            `${this.currentLocation[0].toFixed(4)}, ${this.currentLocation[1].toFixed(4)}`;
        
        // Fetch and display routes
        this.fetchRoutes(bbox);
    }

    createBoundingBox(lat, lng, widthMiles, heightMiles) {
        // Convert miles to kilometers for turf.js
        const widthKm = widthMiles * 1.60934;
        const heightKm = heightMiles * 1.60934;

        // Create bounding box using turf.js
        const point = turf.point([lng, lat]);
        const boxPolygon = turf.bbox(turf.buffer(point, Math.max(widthKm, heightKm) / 2, {
            units: 'kilometers'
        }));

        return {
            west: boxPolygon[0],
            south: boxPolygon[1],
            east: boxPolygon[2],
            north: boxPolygon[3]
        };
    }

    async fetchRoutes(bbox) {
        try {
            document.getElementById('status').textContent = 'Fetching route data...';

            const routeType = document.getElementById('routeType').value;
            const url = `https://router.project-osrm.org/route/v1/${routeType}/` +
                       `${this.currentLocation[1]},${this.currentLocation[0]};` +
                       `${bbox.east},${bbox.north}?overview=full&geometries=geojson`;

            const response = await fetch(url);
            const data = await response.json();

            if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                this.displayRoute(data.routes[0].geometry);
                document.getElementById('status').textContent = 'Route displayed';
            } else {
                document.getElementById('status').textContent = 'No route found';
            }
        } catch (error) {
            console.error('Route fetch error:', error);
            document.getElementById('status').textContent = 'Error fetching route';
        }
    }

    displayRoute(geometry) {
        this.routeLayer.clearLayers();
        
        L.geoJSON(geometry, {
            style: {
                color: '#4CAF50',
                weight: 4,
                opacity: 0.8
            }
        }).addTo(this.routeLayer);
    }
}

// Initialize the application when the page loads
window.addEventListener('load', () => {
    new MapPathfinder();
});