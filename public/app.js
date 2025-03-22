class PathfindingVisualizer {
    constructor() {
        this.width = 800;
        this.height = 600;
        this.points = [];
        this.terrain = new Map();
        
        this.svg = d3.select('#map')
            .append('svg')
            .attr('width', '100%')
            .attr('height', '100%')
            .attr('viewBox', `0 0 ${this.width} ${this.height}`)
            .attr('preserveAspectRatio', 'xMidYMid meet');

        this.projection = d3.geoAlbersUsa()
            .translate([this.width / 2, this.height / 2])
            .scale(1000);

        this.path = d3.geoPath()
            .projection(this.projection);

        this.setupEventListeners();
        this.loadAndDisplayMap();
    }

    setupEventListeners() {
        document.getElementById('generateMap').addEventListener('click', () => {
            this.resetMap();
            this.generateRandomTerrain();
        });

        this.svg.on('click', (event) => {
            const [x, y] = d3.pointer(event);
            if (this.points.length < 2) {
                this.addPoint(x, y);
            }
            if (this.points.length === 2) {
                this.findPath();
            }
        });
    }

    async loadAndDisplayMap() {
        try {
            const response = await fetch('https://d3js.org/us-10m.v1.json');
            const us = await response.json();
            
            this.svg.append('g')
                .selectAll('path')
                .data(topojson.feature(us, us.objects.states).features)
                .enter()
                .append('path')
                .attr('class', 'state')
                .attr('d', this.path);

            this.generateRandomTerrain();
        } catch (error) {
            console.error('Error loading map:', error);
            document.getElementById('status').textContent = 'Error loading map';
        }
    }

    generateRandomTerrain() {
        this.terrain.clear();
        // Add random terrain difficulty (1-5) for each grid cell
        for (let x = 0; x < this.width; x += 20) {
            for (let y = 0; y < this.height; y += 20) {
                if (Math.random() < 0.3) { // 30% chance of terrain
                    this.terrain.set(`${x},${y}`, Math.floor(Math.random() * 5) + 1);
                }
            }
        }
        this.visualizeTerrain();
    }

    visualizeTerrain() {
        const terrainGroup = this.svg.select('.terrain-group');
        if (terrainGroup.empty()) {
            this.svg.append('g')
                .attr('class', 'terrain-group');
        }

        const terrainData = Array.from(this.terrain.entries())
            .map(([coord, difficulty]) => {
                const [x, y] = coord.split(',').map(Number);
                return { x, y, difficulty };
            });

        const colorScale = d3.scaleLinear()
            .domain([1, 5])
            .range(['#ffeda0', '#f03b20']);

        this.svg.select('.terrain-group')
            .selectAll('rect')
            .data(terrainData)
            .join('rect')
            .attr('x', d => d.x)
            .attr('y', d => d.y)
            .attr('width', 20)
            .attr('height', 20)
            .attr('fill', d => colorScale(d.difficulty))
            .attr('opacity', 0.5);
    }

    addPoint(x, y) {
        this.points.push([x, y]);
        this.svg.append('circle')
            .attr('class', 'point')
            .attr('cx', x)
            .attr('cy', y);
        
        document.getElementById('status').textContent = 
            this.points.length === 1 ? 'Select destination point' : 'Finding path...';
    }

    resetMap() {
        this.points = [];
        this.svg.selectAll('.point').remove();
        this.svg.selectAll('.path').remove();
        this.svg.selectAll('.visited').remove();
        document.getElementById('status').textContent = 'Select starting point';
    }

    async findPath() {
        const [start, end] = this.points;
        const path = await this.astar(start, end);
        if (path) {
            this.animatePath(path);
        }
    }

    heuristic(a, b) {
        return Math.sqrt(Math.pow(b[0] - a[0], 2) + Math.pow(b[1] - a[1], 2));
    }

    getNeighbors([x, y]) {
        const directions = [
            [0, -20], [20, 0], [0, 20], [-20, 0],
            [-20, -20], [20, -20], [20, 20], [-20, 20]
        ];
        return directions
            .map(([dx, dy]) => [x + dx, y + dy])
            .filter(([nx, ny]) => 
                nx >= 0 && nx < this.width && 
                ny >= 0 && ny < this.height
            );
    }

    async astar(start, end) {
        const gridStart = [
            Math.round(start[0] / 20) * 20,
            Math.round(start[1] / 20) * 20
        ];
        const gridEnd = [
            Math.round(end[0] / 20) * 20,
            Math.round(end[1] / 20) * 20
        ];

        const openSet = new Set([gridStart.toString()]);
        const cameFrom = new Map();
        const gScore = new Map([[gridStart.toString(), 0]]);
        const fScore = new Map([[gridStart.toString(), this.heuristic(gridStart, gridEnd)]]);

        while (openSet.size > 0) {
            let current = Array.from(openSet)
                .reduce((a, b) => (fScore.get(a) || Infinity) < (fScore.get(b) || Infinity) ? a : b);
            
            if (current === gridEnd.toString()) {
                return this.reconstructPath(cameFrom, current);
            }

            openSet.delete(current);
            const [cx, cy] = current.split(',').map(Number);
            
            // Visualize visited node
            this.svg.append('rect')
                .attr('class', 'visited')
                .attr('x', cx)
                .attr('y', cy)
                .attr('width', 20)
                .attr('height', 20);

            await new Promise(resolve => setTimeout(resolve, 10)); // Animation delay

            for (let neighbor of this.getNeighbors([cx, cy])) {
                const neighborStr = neighbor.toString();
                const tentativeGScore = (gScore.get(current) || 0) + 
                    (this.terrain.get(neighborStr) || 1);

                if (!gScore.has(neighborStr) || tentativeGScore < gScore.get(neighborStr)) {
                    cameFrom.set(neighborStr, current);
                    gScore.set(neighborStr, tentativeGScore);
                    fScore.set(neighborStr, tentativeGScore + this.heuristic(neighbor, gridEnd));
                    openSet.add(neighborStr);
                }
            }
        }

        document.getElementById('status').textContent = 'No path found!';
        return null;
    }

    reconstructPath(cameFrom, current) {
        const path = [current];
        while (cameFrom.has(current)) {
            current = cameFrom.get(current);
            path.unshift(current);
        }
        return path.map(pos => pos.split(',').map(Number));
    }

    animatePath(path) {
        const lineGenerator = d3.line();
        const pathElement = this.svg.append('path')
            .attr('class', 'path')
            .attr('d', lineGenerator(path))
            .attr('stroke-dasharray', function() {
                return this.getTotalLength();
            })
            .attr('stroke-dashoffset', function() {
                return this.getTotalLength();
            });

        pathElement.transition()
            .duration(1000)
            .attr('stroke-dashoffset', 0)
            .on('end', () => {
                document.getElementById('status').textContent = 'Path found!';
            });
    }
}

// Initialize the visualizer when the page loads
window.addEventListener('load', () => {
    new PathfindingVisualizer();
});