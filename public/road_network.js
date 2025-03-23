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
        this.ready = false;
    }

    async fetchRoadData(bounds) {
        this.bounds = bounds;
        const query = this.buildOverpassQuery(bounds);
        
        try {
            const response = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                body: query
            });

            if (!response.ok) {
                throw new Error('Failed to fetch road data');
            }

            const data = await response.json();
            this.processOsmData(data);
            this.ready = true;
            return true;

        } catch (error) {
            console.error('Error fetching road data:', error);
            return false;
        }
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

    processOsmData(data) {
        // Clear existing data
        this.nodes.clear();
        this.edges.clear();

        // Process nodes
        const nodes = new Map();
        data.elements.filter(e => e.type === 'node').forEach(node => {
            nodes.set(node.id, [node.lat, node.lon]);
        });

        // Process ways (roads)
        data.elements.filter(e => e.type === 'way').forEach(way => {
            const roadType = way.tags.highway;
            const name = way.tags.name || '';

            // Create or get nodes for each point in the way
            for (let i = 0; i < way.nodes.length - 1; i++) {
                const [node1Lat, node1Lon] = nodes.get(way.nodes[i]);
                const [node2Lat, node2Lon] = nodes.get(way.nodes[i + 1]);

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
        let nearestNode = null;
        let minDistance = Infinity;

        for (const node of this.nodes.values()) {
            const distance = this.calculateDistance(lat, lng, node.lat, node.lng);
            if (distance < minDistance) {
                minDistance = distance;
                nearestNode = node;
            }
        }

        return nearestNode;
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