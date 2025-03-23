class USMapDisplay {
    constructor() {
        // US boundary box for random location generation
        this.usBounds = {
            north: 49.384358,  // Northernmost point
            south: 24.396308,  // Southernmost point
            east: -66.934570,  // Easternmost point
            west: -125.000000  // Westernmost point
        };

        this.map = null;
        this.debug = true;
        this.currentBox = null;
        this.currentMarker = null;

        // Initialize the map
        this.initialize();
    }

    log(message, data = null) {
        if (this.debug) {
            console.log(`[USMapDisplay] ${message}`, data || '');
        }
    }

    initialize() {
        try {
            this.log('Initializing map...');
            
            // Create the map instance centered on US
            this.map = L.map('map-container', {
                center: [39.8283, -98.5795],
                zoom: 4,
                minZoom: 3,
                maxZoom: 18
            });

            // Add OpenStreetMap tile layer
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 18
            }).addTo(this.map);

            // Set up event listeners
            this.setupEventListeners();

            // Enable button once map is ready
            this.map.whenReady(() => {
                this.log('Map initialization complete');
                const button = document.getElementById('randomLocation');
                const status = document.getElementById('status');
                
                if (button && status) {
                    button.disabled = false;
                    status.textContent = 'Map ready - Click button to generate location';
                }
            });

            // Handle map load error
            this.map.on('error', (error) => {
                this.log('Map error:', error);
                document.getElementById('status').textContent = 'Error loading map';
            });

        } catch (error) {
            this.log('Error in initialization:', error);
            const status = document.getElementById('status');
            if (status) {
                status.textContent = 'Failed to initialize map';
            }
        }
    }

    setupEventListeners() {
        const button = document.getElementById('randomLocation');
        if (button) {
            button.addEventListener('click', () => this.generateRandomLocation());
        }
    }

    generateRandomLocation() {
        try {
            this.log('Generating random location...');
            
            // Generate random coordinates within US bounds
            const lat = Math.random() * (this.usBounds.north - this.usBounds.south) + this.usBounds.south;
            const lng = Math.random() * (this.usBounds.east - this.usBounds.west) + this.usBounds.west;
            
            this.log('Random location generated:', [lat, lng]);
            
            // Clear previous markers and boxes
            if (this.currentMarker) {
                this.currentMarker.remove();
            }
            if (this.currentBox) {
                this.currentBox.remove();
            }

            // Create marker at random location
            this.currentMarker = L.marker([lat, lng]).addTo(this.map);

            // Create and display the bounding box
            this.createBoundingBox(lat, lng);
            
            // Update status
            document.getElementById('status').textContent =
                `Location selected: ${lat.toFixed(4)}°N, ${lng.toFixed(4)}°W`;

        } catch (error) {
            this.log('Error generating location:', error);
            document.getElementById('status').textContent = 'Error generating location';
        }
    }

    createBoundingBox(lat, lng) {
        try {
            // Constants for conversion
            const MILES_TO_KM = 1.60934;
            const KM_PER_DEGREE_LAT = 111.32; // Approximate km per degree of latitude
            const KM_PER_DEGREE_LNG = 111.32 * Math.cos(lat * (Math.PI / 180)); // Adjust for latitude

            // Convert 10x20 miles to kilometers
            const widthKm = 10 * MILES_TO_KM;
            const heightKm = 20 * MILES_TO_KM;

            // Calculate degree offsets
            const latOffset = heightKm / (2 * KM_PER_DEGREE_LAT);
            const lngOffset = widthKm / (2 * KM_PER_DEGREE_LNG);

            // Create bounding box coordinates
            const bounds = [
                [lat + latOffset, lng - lngOffset], // Northwest
                [lat + latOffset, lng + lngOffset], // Northeast
                [lat - latOffset, lng + lngOffset], // Southeast
                [lat - latOffset, lng - lngOffset], // Southwest
                [lat + latOffset, lng - lngOffset]  // Close the polygon
            ];

            // Create and style the box
            this.currentBox = L.polygon(bounds, {
                color: '#f44336',
                weight: 2,
                fillColor: '#f44336',
                fillOpacity: 0.1,
                dashArray: '5, 5'
            }).addTo(this.map);

            // Fit map to the box with some padding
            this.map.fitBounds(this.currentBox.getBounds(), {
                padding: [50, 50],
                maxZoom: 13 // Limit zoom level for context
            });

            this.log('Bounding box created');

        } catch (error) {
            this.log('Error creating bounding box:', error);
            document.getElementById('status').textContent = 'Error creating bounding box';
        }
    }
}

// Initialize the application when the page loads
window.addEventListener('load', () => {
    try {
        new USMapDisplay();
    } catch (error) {
        console.error('Failed to start application:', error);
        document.getElementById('status').textContent = 'Failed to start application';
    }
});