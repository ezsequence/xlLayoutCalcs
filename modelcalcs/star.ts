import {
    NodeCoord,
    NodeLoc,
    EffectBufferDescriptionInput,
    ModelProperty,
    ModelType,
    GetNodeResult,
} from "./modelbase";
import { defEffectBufferDescriptionOutput } from "./modelshared";
import { defNodeCoord } from "./modelshared";
import { defNodeLoc } from "./modelshared";
import { getWorldMatrixForBoxed } from "./modelshared";
import { BaseModelClass } from "./modelshared";

const starProperties: ModelProperty[] = [
    {name: 'StarStringCount', ptype: "INTEGER", fieldName: 'numStrings', xmlName: 'NumStrings', description: "# Strings"},
    {name: 'StarLightCount', ptype: "INTEGER", fieldName: 'nodesPerString', xmlName: 'NodesPerString', description: "Nodes Per String"},
    {name: 'StarStrandCount', ptype: "INTEGER", fieldName: 'numPoints', xmlName: 'StarPoints', description: "# Points"},
    {name: 'LayerSizes', ptype: "NODE_ARRAY", fieldName: 'layerSizes', xmlName: "LayerSizes", description: "Layer Sizes"},
    {name: 'starSizes', ptype: "NODE_ARRAY", fieldName: 'starSizes', xmlName: "starSizes", description: "Star Sizes (legacy, converted to LayerSizes)"},
    {name: 'StarRatio', ptype: "FLOAT", fieldName: 'starRatio', xmlName: 'starRatio', description: "Outer to Inner Ratio"},
    {name: 'StarCenterPercent', ptype: "INTEGER", fieldName: 'innerPercent', xmlName: 'starCenterPercent', description: "Inner Layer %"},
    {name: 'StarStartLocation', ptype: "STRING", fieldName: 'starStartLocation', xmlName: 'StarStartLocation', description: "Starting Location"},
];

function contains(str: string, substr: string): boolean {
    return str.indexOf(substr) !== -1;
}

function lineLength(start: {x: number, y: number}, end: {x: number, y: number}): number {
    return Math.sqrt((end.x - start.x) * (end.x - start.x) + (end.y - start.y) * (end.y - start.y));
}

function getPointOnCircle(radius: number, angle: number): {x: number, y: number} {
    return {
        x: radius * Math.sin(angle),
        y: radius * Math.cos(angle)
    };
}

function getPositionOnLine(start: {x: number, y: number}, end: {x: number, y: number}, distance: number): {x: number, y: number} {
    const len = lineLength(start, end);
    if (len === 0) return start;
    const t = distance / len;
    return {
        x: (1.0 - t) * start.x + t * end.x,
        y: (1.0 - t) * start.y + t * end.y
    };
}

export class StarModel extends BaseModelClass {
    modelType: ModelType = StarModelType;
    numStrings: number = 1;
    nodesPerString: number = 50;
    numPoints: number = 5;
    lightsPerNode: number = 1;
    singleNode: boolean = false;
    layerSizes: number[] = [];
    starSizes: number[] = [];  // Legacy attribute, converted to layerSizes
    starRatio: number = 2.618034;
    innerPercent: number = -1;
    starStartLocation: string = "Bottom Ctr-CW";

    constructor() {super();}

    getType(): string {
        return "Star";
    }

    getProperties(): ModelProperty[] {
        return starProperties;
    }

    getLayerSizeCount(): number {
        return this.layerSizes.length > 0 ? this.layerSizes.length : 1;
    }

    getLayerSize(layer: number): number {
        if (this.layerSizes.length === 0) {
            return this.numStrings * this.nodesPerString;
        }
        return this.layerSizes[layer] || 0;
    }

    getNumNodes() {
        if (this.singleNode) {
            return this.numStrings;  // One node per string in single node mode
        }
        return this.numStrings * this.nodesPerString;
    }

    getNumPhysicalStrings(): number {
        return this.numStrings;
    }

    getNodeCoords(): GetNodeResult {
        const nodes: NodeLoc[] = [];
        let logicalBufferWidth = 1, logicalBufferHeight = 1, logicalBufferDepth = 1;

        const numLights = this.numStrings * this.nodesPerString;
        const nodeCount = this.getNumNodes();
        const numPoints = this.numPoints < 2 ? 2 : this.numPoints;

        // Initialize layer sizes
        let layerSizeCount = this.getLayerSizeCount();
        const layerSizes: number[] = [];
        // Use layerSizes if available, otherwise try legacy starSizes
        const sourceSizes = this.layerSizes.length > 0 ? this.layerSizes : this.starSizes;
        if (sourceSizes.length === 0) {
            layerSizes.push(numLights);
            layerSizeCount = 1;
        } else {
            for (let l = 0; l < sourceSizes.length; l++) {
                layerSizes.push(sourceSizes[l]);
            }
            layerSizeCount = layerSizes.length;
        }

        if (layerSizeCount === 1) {
            layerSizes[0] = numLights;
        }

        // Create nodes
        if (this.singleNode) {
            // Single node mode: one node per string, all lights as coords
            const lightsPerString = this.nodesPerString * this.lightsPerNode;
            for (let i = 0; i < nodeCount; ++i) {
                const nn = defNodeLoc();
                for (let c = 0; c < lightsPerString; ++c) {
                    nn.coords.push(defNodeCoord());
                }
                nodes.push(nn);
            }
        } else {
            for (let i = 0; i < nodeCount; ++i) {
                const nn = defNodeLoc();
                for (let c = 0; c < this.lightsPerNode; ++c) {
                    nn.coords.push(defNodeCoord());
                }
                nodes.push(nn);
            }
        }

        // Calculate buffer size - find max lights needed on any layer
        let maxLightsOnLayer = 0;
        for (let l = 0; l < layerSizeCount; l++) {
            const layersOutside = layerSizeCount - l - 1;
            const inflated = 1 + Math.floor(layerSizes[l] * (1.0 + (layersOutside / layerSizeCount)));
            maxLightsOnLayer = Math.max(maxLightsOnLayer, inflated);
        }

        // In single node mode, buffer is nodeCount x 1 (all coords at same position per node)
        if (this.singleNode) {
            logicalBufferWidth = nodeCount;
            logicalBufferHeight = 1;
        } else {
            logicalBufferWidth = maxLightsOnLayer;
            logicalBufferHeight = maxLightsOnLayer;
        }

        const BufferWi = maxLightsOnLayer;
        const BufferHt = maxLightsOnLayer;

        // Star geometry
        let outerRadius = BufferWi / 2.0;
        const ratio = this.starRatio < 1 ? 1 : this.starRatio;
        let innerRadius = outerRadius / ratio;

        let layerRadiusDelta = 0;
        let innerPct = this.innerPercent;
        if (layerSizeCount > 1) {
            if (innerPct === -1) {
                // C++ stores innerPercent as int, so truncate the division result
                innerPct = Math.trunc(100.0 / layerSizeCount);
            }
            layerRadiusDelta = (outerRadius * (100.0 - innerPct)) / (100.0 * (layerSizeCount - 1.0));
        }

        const pointAngleGap = (Math.PI * 2.0) / numPoints;
        const directionUnit = contains(this.starStartLocation, "-CCW") ? -1.0 : 1.0;

        // Calculate start angle
        let startAngle: number;
        if (contains(this.starStartLocation, "Top")) {
            startAngle = 0;
        } else if (contains(this.starStartLocation, "Bottom Ctr")) {
            startAngle = Math.PI;
        } else if (contains(this.starStartLocation, "Left")) {
            startAngle = Math.PI;
            if (numPoints % 2 === 1) {
                startAngle += pointAngleGap / 2.0;
            }
        } else {
            startAngle = Math.PI;
            if (numPoints % 2 === 1) {
                startAngle -= pointAngleGap / 2.0;
            }
        }

        const starSegments = 2 * numPoints;
        const coordsPerNode = this.lightsPerNode;

        // Determine layer processing order
        let startLayer = layerSizeCount - 1;
        let endLayer = -1;
        let layerIncr = -1;
        if (contains(this.starStartLocation, "Inside")) {
            startLayer = 0;
            endLayer = layerSizeCount;
            layerIncr = 1;
            outerRadius -= layerRadiusDelta * (layerSizeCount - 1);
            innerRadius = outerRadius / ratio;
            layerRadiusDelta *= -1;
        }

        let currentNode = 0;

        if (!this.singleNode) {
            for (let l = startLayer; l !== endLayer; l += layerIncr) {
                if (currentNode >= nodeCount) break;

                const layerNodes = layerSizes[l];
                const endNodeForLayer = currentNode + layerNodes;

                if (layerNodes === 0) continue;

                const startOuter = !contains(this.starStartLocation, "Bottom Ctr");

                // Calculate segment length
                const start = getPointOnCircle(startOuter ? outerRadius : innerRadius, startAngle);
                const end = getPointOnCircle(startOuter ? innerRadius : outerRadius, startAngle + (pointAngleGap / 2.0));
                const segmentLength = lineLength(start, end);
                const totalSegmentLength = starSegments * segmentLength;
                const coordGap = totalSegmentLength / (layerNodes * coordsPerNode);

                let curPos = 0;
                let curAngle = startAngle;
                let segStartLen = 0;
                let segEndLen = 0;
                let isOuter = startOuter;

                for (let s = 0; s < starSegments; s++) {
                    if (currentNode >= nodeCount) break;

                    const segStart = getPointOnCircle(isOuter ? outerRadius : innerRadius, curAngle);
                    const segEnd = getPointOnCircle(isOuter ? innerRadius : outerRadius, curAngle + (pointAngleGap * directionUnit) / 2.0);
                    segStartLen = segEndLen;
                    segEndLen = segStartLen + segmentLength;

                    if (s === starSegments - 1) {
                        segEndLen += 0.001;
                    }

                    while (curPos < segEndLen && currentNode < endNodeForLayer) {
                        nodes[currentNode].physicalNum = currentNode;
                        nodes[currentNode].physicalStrand = l;
                        nodes[currentNode].logicalNum = currentNode;

                        for (let c = 0; c < coordsPerNode; c++) {
                            const point = getPositionOnLine(segStart, segEnd, curPos - segStartLen);

                            // Use Math.trunc to match C++ truncation toward zero behavior
                            nodes[currentNode].coords[c].bufX = Math.trunc(point.x + Math.floor(BufferWi / 2));
                            nodes[currentNode].coords[c].bufY = Math.trunc(point.y + Math.floor(BufferHt / 2) - 1);
                            nodes[currentNode].coords[c].modelX = point.x;
                            nodes[currentNode].coords[c].modelY = point.y;

                            curPos += coordGap;
                        }

                        nodes[currentNode].logicalX = nodes[currentNode].coords[0].bufX;
                        nodes[currentNode].logicalY = nodes[currentNode].coords[0].bufY;

                        currentNode++;
                        if (currentNode >= nodeCount) break;
                    }

                    curAngle += (pointAngleGap * directionUnit) / 2.0;
                    isOuter = !isOuter;
                }

                outerRadius -= layerRadiusDelta;
                innerRadius = outerRadius / ratio;
            }

            // Handle leftover nodes
            for (let n = currentNode; n < nodeCount; n++) {
                nodes[n].physicalNum = n;
                nodes[n].logicalNum = n;
                for (const c of nodes[n].coords) {
                    c.bufX = 0;
                    c.bufY = 0;
                    c.modelX = 0;
                    c.modelY = 0;
                }
                nodes[n].logicalX = 0;
                nodes[n].logicalY = 0;
            }
        } else {
            // Single node mode - all coords of a node at same buffer position
            for (let l = startLayer; l !== endLayer; l += layerIncr) {
                if (currentNode >= nodeCount) break;

                const layerSize = layerSizes[l];
                const coordsForLayer = Math.min(layerSize, nodes[currentNode].coords.length);

                if (coordsForLayer === 0) continue;

                const startOuter = !contains(this.starStartLocation, "Bottom Ctr");

                const start = getPointOnCircle(startOuter ? outerRadius : innerRadius, startAngle);
                const end = getPointOnCircle(startOuter ? innerRadius : outerRadius, startAngle + (pointAngleGap / 2.0));
                const segmentLength = lineLength(start, end);
                const totalSegmentLength = starSegments * segmentLength;
                const coordGap = totalSegmentLength / coordsForLayer;

                let currentCoord = 0;
                let curPos = 0;
                let curAngle = startAngle;
                let isOuter = startOuter;

                nodes[currentNode].physicalNum = currentNode;
                nodes[currentNode].physicalStrand = l;
                nodes[currentNode].logicalNum = currentNode;

                for (let s = 0; s < starSegments; s++) {
                    if (currentCoord >= coordsForLayer) break;

                    const segStart = getPointOnCircle(isOuter ? outerRadius : innerRadius, curAngle);
                    const segEnd = getPointOnCircle(isOuter ? innerRadius : outerRadius, curAngle + (pointAngleGap * directionUnit) / 2.0);
                    const segStartLen = s * segmentLength;
                    const segEndLen = segStartLen + segmentLength;

                    while (curPos < segEndLen && currentCoord < coordsForLayer) {
                        const point = getPositionOnLine(segStart, segEnd, curPos - segStartLen);

                        // Single node mode: all coords at same buffer position
                        nodes[currentNode].coords[currentCoord].bufX = currentNode;
                        nodes[currentNode].coords[currentCoord].bufY = 0;
                        // Model coords still follow star geometry
                        nodes[currentNode].coords[currentCoord].modelX = point.x;
                        nodes[currentNode].coords[currentCoord].modelY = point.y;

                        curPos += coordGap;
                        currentCoord++;
                    }

                    curAngle += (pointAngleGap * directionUnit) / 2.0;
                    isOuter = !isOuter;
                }

                nodes[currentNode].logicalX = currentNode;
                nodes[currentNode].logicalY = 0;

                currentNode++;
                outerRadius -= layerRadiusDelta;
                innerRadius = outerRadius / ratio;
            }
        }

        const toWorldCoords = getWorldMatrixForBoxed(this);

        return {
            toWorldCoords,
            toWorld2DCoords: toWorldCoords, // 2D model, no perspective needed
            logicalBufferWidth,
            logicalBufferHeight,
            logicalBufferDepth,
            nodes,
        };
    }

    getBufferDescription(ind: EffectBufferDescriptionInput) {
        const ebdo = defEffectBufferDescriptionOutput();
        return ebdo;
    }
}

export const StarModelType: ModelType = {
    typeName: "Star",
    displayAs: "Star",
    modelXmlTag: 'starmodel',
};
