class RoadNode {
    constructor(id, lat, lng) {
        this.id = id;
        this.lat = lat;
        this.lng = lng;
        this.connections = new Map(); // Map of nodeId -> RoadEdge
        this.g = Infinity;
        this.h = 0;
        this.f = Infinity;
        this.parent = null;
    }

    reset() {
        this.g = Infinity;
        this.h = 0;
        this.f = Infinity;
        this.parent = null;
    }
}

class RoadEdge {
    constructor(id, source, target, distance, roadType) {
        this.id = id;
        this.source = source;
        this.target = target;
        this.distance = distance; // meters
        this.roadType = roadType;
        this.wayId = null;
        this.name = '';
        this.path = []; // Array of [lat, lng] points forming the road geometry
    }

    getSpeed() {
        // Estimated speeds in mph for different road types
        const speedLimits = {
            'motorway': 65,
            'trunk': 55,
            'primary': 45,
            'secondary': 35,
            'tertiary': 30,
            'residential': 25,
            'service': 15,
            'default': 25
        };
        return speedLimits[this.roadType] || speedLimits.default;
    }

    // Get estimated travel time in minutes
    getTravelTime() {
        const speedMph = this.getSpeed();
        const distanceMiles = this.distance * 0.000621371; // Convert meters to miles
        return (distanceMiles / speedMph) * 60; // Convert hours to minutes
    }
}

class RoadNetwork {
    constructor() {
        this.nodes = new Map(); // id -> RoadNode
        this.edges = new Map(); // id -> RoadEdge
        this.bounds = null;
        this.lastSuccessBounds = null;
        this.ready = false;
        this.loading = false;
        this.spatialIndex = null;
        this.nodeLocations = [];
        this.searchRadius = 100; // meters
        this.loadProgress = 0;
    }

    async fetchRoadData(bounds) {
        if (this.loading) {
            console.warn('Road data fetch already in progress');
            return false;
        }

        this.loading = true;
        this.loadProgress = 0;
        this.ready = false;
        this.bounds = bounds;
        
        const maxRetries = 3;
        let retryCount = 0;
        let lastError = null;

        while (retryCount < maxRetries) {
            try {
                console.log(`Fetching road data (attempt ${retryCount + 1}/${maxRetries})...`);
                const query = this.buildOverpassQuery(bounds);
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

                const response = await fetch('https://overpass-api.de/api/interpreter', {
                    method: 'POST',
                    body: query,
                    signal: controller.signal,
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                this.loadProgress = 50;
                
                // Validate response data
                if (!data || !data.elements || !Array.isArray(data.elements)) {
                    throw new Error('Invalid response format from Overpass API');
                }

                // Process the data
                await this.processOsmData(data);
                this.lastSuccessBounds = bounds;
                this.loading = false;
                console.log('Road data fetched and processed successfully');
                return true;

            } catch (error) {
                lastError = error;
                console.error(`Error fetching road data (attempt ${retryCount + 1}):`, error);
                
                if (error.name === 'AbortError') {
                    console.log('Request timed out, retrying...');
                } else if (error.message.includes('429')) {
                    console.log('Rate limit exceeded, waiting before retry...');
                    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
                }
                
                retryCount++;
                
                if (retryCount === maxRetries) {
                    console.error('Max retries reached, giving up');
                    this.ready = false;
                    this.loading = false;
                    throw new Error(`Failed to fetch road data after ${maxRetries} attempts: ${lastError.message}`);
                }
                
                // Wait before retrying (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
            }
        }

        this.loading = false;
        return false;
    }

    buildOverpassQuery(bounds) {
        const { south, west, north, east } = bounds;
        return `[out:json][timeout:25];
        (
          way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|service)$"]
            (${south},${west},${north},${east});
        );
        (._;>;);
        out body;`;
    }

    async processOsmData(data) {
        console.log('Processing OSM data...');
        
        // Reset state
        this.ready = false;
        this.nodes.clear();
        this.edges.clear();
        this.spatialIndex = null;
        this.nodeLocations = [];

        try {
            // Validate data
            if (!data.elements || !Array.isArray(data.elements)) {
                throw new Error('Invalid OSM data format');
            }

            // Process nodes
            console.log('Processing nodes...');
            const nodes = new Map();
            const osmNodes = data.elements.filter(e => e.type === 'node');
            
            if (osmNodes.length === 0) {
                throw new Error('No nodes found in data');
            }

            osmNodes.forEach(node => {
                if (typeof node.id !== 'number' || typeof node.lat !== 'number' || typeof node.lon !== 'number') {
                    console.warn(`Invalid node data: ${JSON.stringify(node)}`);
                    return;
                }
                nodes.set(node.id, [node.lat, node.lon]);
            });

            this.loadProgress = 60;
            console.log(`Processed ${nodes.size} nodes`);

            // Process ways (roads)
            console.log('Processing ways...');
            const ways = data.elements.filter(e => e.type === 'way' && e.tags && e.tags.highway);
            
            if (ways.length === 0) {
                throw new Error('No roads found in data');
            }

            ways.forEach(way => {
                const roadType = way.tags.highway;
                const name = way.tags.name || '';

                // Validate way nodes
                if (!Array.isArray(way.nodes) || way.nodes.length < 2) {
                    console.warn(`Invalid way data: ${JSON.stringify(way)}`);
                    return;
                }

                // Create or get nodes for each point in the way
                for (let i = 0; i < way.nodes.length - 1; i++) {
                    const node1Data = nodes.get(way.nodes[i]);
                    const node2Data = nodes.get(way.nodes[i + 1]);

                    if (!node1Data || !node2Data) {
                        console.warn(`Missing node data for way ${way.id}`);
                        continue;
                    }

                    const [node1Lat, node1Lon] = node1Data;
                    const [node2Lat, node2Lon] = node2Data;

                    // Create RoadNodes if they don't exist
                    if (!this.nodes.has(way.nodes[i])) {
                        this.nodes.set(way.nodes[i], new RoadNode(way.nodes[i], node1Lat, node1Lon));
                    }
                    if (!this.nodes.has(way.nodes[i + 1])) {
                        this.nodes.set(way.nodes[i + 1], new RoadNode(way.nodes[i + 1], node2Lat, node2Lon));
                    }

                    // Create edge
                    const distance = this.calculateDistance(node1Lat, node1Lon, node2Lat, node2Lon);
                    const edge = new RoadEdge(
                        `${way.id}-${i}`,
                        way.nodes[i],
                        way.nodes[i + 1],
                        distance,
                        roadType
                    );
                    edge.wayId = way.id;
                    edge.name = name;
                    edge.path = [[node1Lat, node1Lon], [node2Lat, node2Lon]];

                    // Add edge to network
                    this.edges.set(edge.id, edge);

                    // Connect nodes
                    const node1 = this.nodes.get(way.nodes[i]);
                    const node2 = this.nodes.get(way.nodes[i + 1]);
                    
                    node1.connections.set(way.nodes[i + 1], edge);
                    
                    // For two-way roads, add reverse connection
                    if (!way.tags.oneway || way.tags.oneway === 'no') {
                        const reverseEdge = new RoadEdge(
                            `${way.id}-${i}-rev`,
                            way.nodes[i + 1],
                            way.nodes[i],
                            distance,
                            roadType
                        );
                        reverseEdge.wayId = way.id;
                        reverseEdge.name = name;
                        reverseEdge.path = [[node2Lat, node2Lon], [node1Lat, node1Lon]];
                        
                        this.edges.set(reverseEdge.id, reverseEdge);
                        node2.connections.set(way.nodes[i], reverseEdge);
                    }
                }
            });

            this.loadProgress = 80;

            // Build spatial index for faster node searches
            console.log('Building spatial index...');
            this.buildSpatialIndex();

            // Validate final network state
            if (this.nodes.size === 0 || this.edges.size === 0) {
                throw new Error('Failed to build road network - no nodes or edges created');
            }

            this.loadProgress = 100;
            console.log(`Network built with ${this.nodes.size} nodes and ${this.edges.size} edges`);
            
            // Set ready flag only after all validations pass
            this.ready = true;

        } catch (error) {
            console.error('Error processing OSM data:', error);
            this.nodes.clear();
            this.edges.clear();
            this.spatialIndex = null;
            this.nodeLocations = [];
            this.bounds = null;
            throw error;
        }
    }

    buildSpatialIndex() {
        const points = [];
        this.nodeLocations = [];
        
        // Prepare points for indexing
        let i = 0;
        for (const node of this.nodes.values()) {
            points.push({
                x: node.lng,
                y: node.lat,
                id: node.id
            });
            this.nodeLocations.push(node);
            i++;
        }

        // Create KDBush index
        this.spatialIndex = new KDBush(points, p => p.x, p => p.y);
        console.log('Spatial index built successfully');
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        // Haversine formula
        const R = 6371e3; // Earth's radius in meters
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                 Math.cos(φ1) * Math.cos(φ2) *
                 Math.sin(Δλ/2) * Math.sin(Δλ/2);
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c; // Distance in meters
    }

    findNearestNode(lat, lng) {
        // Debug logging
        console.log(`Finding nearest node to [${lat}, ${lng}]`);
        
        if (!this.ready) {
            console.warn('Road network not ready');
            return null;
        }

        if (this.loading) {
            console.warn('Search blocked - network loading in progress');
            return null;
        }

        if (!this.spatialIndex) {
            console.warn('Spatial index not built');
            return null;
        }

        // Convert search radius from meters to degrees (approximate)
        const radiusInDegrees = this.searchRadius / 111000; // 111km per degree

        // Use spatial index to find nearest nodes
        const nearestIndices = this.spatialIndex.within(lng, lat, radiusInDegrees);
        
        if (nearestIndices.length === 0) {
            console.log(`No nodes found within ${this.searchRadius}m`);
            return null;
        }

        // Find the closest node among candidates
        let nearestNode = null;
        let minDistance = Infinity;

        for (const idx of nearestIndices) {
            const node = this.nodes.get(this.nodeLocations[idx].id);
            const distance = this.calculateDistance(lat, lng, node.lat, node.lng);
            
            if (distance < minDistance) {
                minDistance = distance;
                nearestNode = node;
            }
        }

        if (nearestNode) {
            console.log(`Found nearest node: [${nearestNode.lat}, ${nearestNode.lng}] at distance: ${minDistance}m`);
            return nearestNode;
        }

        return null;
    }

    getLoadProgress() {
        return this.loadProgress;
    }

    resetNodes() {
        for (const node of this.nodes.values()) {
            node.reset();
        }
    }

    getNodeNeighbors(nodeId) {
        const node = this.nodes.get(nodeId);
        return node ? Array.from(node.connections.entries()) : [];
    }

    // Get bounding box that contains all nodes
    getBounds() {
        if (!this.bounds) {
            let minLat = Infinity, maxLat = -Infinity;
            let minLng = Infinity, maxLng = -Infinity;

            for (const node of this.nodes.values()) {
                minLat = Math.min(minLat, node.lat);
                maxLat = Math.max(maxLat, node.lat);
                minLng = Math.min(minLng, node.lng);
                maxLng = Math.max(maxLng, node.lng);
            }

            this.bounds = {
                south: minLat,
                north: maxLat,
                west: minLng,
                east: maxLng
            };
        }
        return this.bounds;
    }
}

// Export for use in other modules
window.RoadNetwork = RoadNetwork;