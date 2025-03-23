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

    contains(element) {
        return this.values.some(v => v.element === element);
    }

    isEmpty() {
        return this.values.length === 0;
    }
}

class RoadPathfinder {
    constructor(roadNetwork) {
        this.network = roadNetwork;
        this.openSet = new PriorityQueue();
        this.closedSet = new Set();
        this.visualCallback = null;
        this.paused = false;
        this.speed = 5;
        this.pathFound = false;
    }

    setVisualizationCallback(callback) {
        this.visualCallback = callback;
    }

    setSpeed(speed) {
        this.speed = speed;
    }

    setPaused(paused) {
        this.paused = paused;
    }

    async findPath(startLat, startLng, endLat, endLng) {
        // Reset previous search state
        this.network.resetNodes();
        this.openSet = new PriorityQueue();
        this.closedSet = new Set();
        this.pathFound = false;

        // Find nearest nodes to start and end points
        const startNode = this.network.findNearestNode(startLat, startLng);
        const endNode = this.network.findNearestNode(endLat, endLng);

        if (!startNode || !endNode) {
            console.error('Could not find start or end node');
            return null;
        }

        console.log('Starting pathfinding:', {
            start: { lat: startNode.lat, lng: startNode.lng },
            end: { lat: endNode.lat, lng: endNode.lng }
        });

        // Initialize start node
        startNode.g = 0;
        startNode.h = this.heuristic(startNode, endNode);
        startNode.f = startNode.h;
        
        this.openSet.enqueue(startNode.id, startNode.f);
        
        let nodesExplored = 0;
        let lastVisualization = Date.now();
        const visualizationInterval = Math.max(1, 11 - this.speed) * 50;

        while (!this.openSet.isEmpty()) {
            if (this.paused) {
                await new Promise(resolve => setTimeout(resolve, 100));
                continue;
            }

            const currentId = this.openSet.dequeue().element;
            const current = this.network.nodes.get(currentId);
            nodesExplored++;

            if (current === endNode) {
                console.log('Path found!', { nodesExplored });
                this.pathFound = true;
                return {
                    path: this.reconstructPath(endNode),
                    nodesExplored,
                    endNode
                };
            }

            this.closedSet.add(currentId);

            // Get neighbors through road connections
            const neighbors = this.network.getNodeNeighbors(currentId);
            
            for (const [neighborId, edge] of neighbors) {
                if (this.closedSet.has(neighborId)) continue;

                const neighbor = this.network.nodes.get(neighborId);
                const tentativeG = current.g + edge.distance;

                if (tentativeG < neighbor.g) {
                    neighbor.parent = current;
                    neighbor.g = tentativeG;
                    neighbor.h = this.heuristic(neighbor, endNode);
                    neighbor.f = neighbor.g + neighbor.h;

                    if (!this.openSet.contains(neighborId)) {
                        this.openSet.enqueue(neighborId, neighbor.f);
                    }
                }
            }

            // Visualization
            if (this.visualCallback) {
                const now = Date.now();
                if (now - lastVisualization >= visualizationInterval) {
                    await this.visualCallback({
                        current: current,
                        openSet: Array.from(this.openSet.values).map(v => this.network.nodes.get(v.element)),
                        closedSet: Array.from(this.closedSet).map(id => this.network.nodes.get(id)),
                        nodesExplored,
                        scores: {
                            g: current.g,
                            h: current.h,
                            f: current.f
                        }
                    });
                    lastVisualization = now;
                }
            }
        }

        console.log('No path found', { nodesExplored });
        return null;
    }

    heuristic(node, goal) {
        // Use straight-line distance (meters) as heuristic
        return this.network.calculateDistance(
            node.lat, node.lng,
            goal.lat, goal.lng
        );
    }

    reconstructPath(endNode) {
        const path = [];
        let current = endNode;
        let totalDistance = 0;
        let totalTime = 0;
        const segments = [];

        while (current && current.parent) {
            const edge = current.parent.connections.get(current.id);
            if (edge) {
                segments.unshift({
                    edge: edge,
                    points: edge.path,
                    distance: edge.distance,
                    time: edge.getTravelTime()
                });
                totalDistance += edge.distance;
                totalTime += edge.getTravelTime();
            }
            path.unshift(current);
            current = current.parent;
        }
        if (current) {
            path.unshift(current);
        }

        return {
            nodes: path,
            segments: segments,
            totalDistance: totalDistance,
            totalTime: totalTime
        };
    }

    // Get the road segments between two adjacent nodes
    getRoadSegment(node1, node2) {
        const edge = node1.connections.get(node2.id);
        return edge ? edge.path : null;
    }
}

// Export for use in other modules
window.RoadPathfinder = RoadPathfinder;