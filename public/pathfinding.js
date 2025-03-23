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

export class AStarPathfinder {
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
                return {
                    path: this.reconstructPath(endNode),
                    nodesExplored
                };
            }

            this.closedSet.add(current);

            // Get neighbors
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

            // Visualization callback
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

        return null; // No path found
    }

    getNeighbors(node) {
        const neighbors = [];
        const row = Math.floor(node.index / this.grid[0].length);
        const col = node.index % this.grid[0].length;

        // Check all 8 surrounding cells
        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                if (i === 0 && j === 0) continue;

                const newRow = row + i;
                const newCol = col + j;

                if (newRow >= 0 && newRow < this.grid.length &&
                    newCol >= 0 && newCol < this.grid[0].length) {
                    neighbors.push(this.grid[newRow][newCol]);
                }
            }
        }

        return neighbors;
    }

    heuristic(node, goal) {
        // Using haversine formula for geographic distance
        const R = 6371; // Earth's radius in km
        const lat1 = node.lat * Math.PI / 180;
        const lat2 = goal.lat * Math.PI / 180;
        const dLat = (goal.lat - node.lat) * Math.PI / 180;
        const dLon = (goal.lng - node.lng) * Math.PI / 180;

        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                 Math.cos(lat1) * Math.cos(lat2) *
                 Math.sin(dLon/2) * Math.sin(dLon/2);
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    distance(nodeA, nodeB) {
        // Using haversine formula for actual distance
        return this.heuristic(nodeA, nodeB);
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