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

const circleProperties: ModelProperty[] = [
    {name: 'CircleStringCount', ptype: "INTEGER", fieldName: 'numStrings', xmlName: 'NumStrings', description: "# Strings"},
    {name: 'CircleLightCount', ptype: "INTEGER", fieldName: 'nodesPerString', xmlName: 'NodesPerString', description: "Nodes Per String"},
    {name: 'CircleCenterPercent', ptype: "INTEGER", fieldName: 'centerPercent', xmlName: 'centerPercent', description: "Center %"},
    {name: 'LayerSizes', ptype: "NODE_ARRAY", fieldName: 'layerSizes', xmlName: "LayerSizes", description: "Layer Sizes"},
    {name: 'Dir', ptype: "STRING", fieldName: 'dir', xmlName: 'Dir', description: "Direction L/R"},
    {name: 'StartSide', ptype: "STRING", fieldName: 'startSide', xmlName: 'StartSide', description: "Start Side T/B"},
    {name: 'InsideOut', ptype: "BOOL", fieldName: 'insideOut', xmlName: 'InsideOut', description: "Inside Out"},
];

export class CircleModel extends BaseModelClass {
    modelType: ModelType = CircleModelType;
    numStrings: number = 1;
    nodesPerString: number = 50;
    centerPercent: number = 0;
    lightsPerNode: number = 1;
    singleNode: boolean = false;
    layerSizes: number[] = [];
    dir: string = "L";
    startSide: string = "T";
    insideOut: boolean = false;

    constructor() {super();}

    getType(): string {
        return "Circle";
    }

    getProperties(): ModelProperty[] {
        return circleProperties;
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

    getStrandLength(strand: number): number {
        if (this.singleNode) return 1;
        return this.getLayerSize(this.getLayerSizeCount() - strand - 1);
    }

    maxSize(): number {
        let maxLights = 0;
        if (this.layerSizes.length === 0) {
            return this.numStrings * this.nodesPerString;
        }
        for (const x of this.layerSizes) {
            if (x > maxLights) maxLights = x;
        }
        return maxLights;
    }

    getNodeCoords(): GetNodeResult {
        const nodes: NodeLoc[] = [];
        let logicalBufferWidth = 1, logicalBufferHeight = 1, logicalBufferDepth = 1;

        const numLights = this.numStrings * this.nodesPerString;
        const nodeCount = this.getNumNodes();

        // Early return if no nodes
        if (nodeCount === 0 || numLights === 0) {
            const toWorldCoords = getWorldMatrixForBoxed(this);
            return { toWorldCoords, toWorld2DCoords: toWorldCoords, logicalBufferWidth, logicalBufferHeight, logicalBufferDepth, nodes };
        }

        const isLtoR = this.dir === 'L';
        const isBotToTop = this.startSide === 'B';

        // Initialize layer sizes if needed
        let layerSizeCount = this.getLayerSizeCount();
        if (layerSizeCount === 0) layerSizeCount = 1;

        const layerSizes: number[] = [];
        if (this.layerSizes.length === 0) {
            layerSizes.push(numLights);
        } else {
            let cnt = 0;
            for (let x = 0; x < this.layerSizes.length; x++) {
                if (cnt + this.layerSizes[x] > numLights) {
                    layerSizes.push(cnt > numLights ? 0 : numLights - cnt);
                } else {
                    layerSizes.push(this.layerSizes[x]);
                }
                cnt += this.layerSizes[x];
            }
        }
        layerSizeCount = layerSizes.length;

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

        // Calculate maxLights from the ADJUSTED layer sizes (matching C++ behavior)
        let maxLights = 0;
        for (const size of layerSizes) {
            if (size > maxLights) maxLights = size;
        }

        if (this.singleNode) {
            // Single node mode: buffer is numStrings x 1
            logicalBufferWidth = nodeCount;
            logicalBufferHeight = 1;

            // All coords of a node at same buffer position
            for (let n = 0; n < nodeCount; n++) {
                nodes[n].physicalNum = n;
                nodes[n].physicalStrand = n;
                nodes[n].physicalNumOnStrand = 0;
                nodes[n].logicalNum = n;
                nodes[n].logicalX = n;
                nodes[n].logicalY = 0;

                const coordCount = nodes[n].coords.length;
                for (let c = 0; c < coordCount; c++) {
                    nodes[n].coords[c].bufX = n;
                    nodes[n].coords[c].bufY = 0;
                }
            }
        } else {
            logicalBufferWidth = maxLights;
            logicalBufferHeight = layerSizeCount;

            // Assign buffer coordinates
            let node = 0;
            let nodesToMap = nodeCount;
            for (let circle = 0; circle < layerSizeCount; circle++) {
                let idx = 0;
                const strandLen = layerSizes[layerSizeCount - circle - 1] || 0;
                const loopCount = Math.min(nodesToMap, strandLen);

                // Skip if no nodes in this layer
                if (strandLen === 0 || loopCount === 0) {
                    continue;
                }

                // Use Math.trunc to match C++ integer division behavior
                const fudge = Math.trunc(-1 * maxLights / strandLen) + 1;

                for (let n = 0; n < loopCount; n++) {
                    if (node >= nodeCount) break;

                    nodes[node].physicalNum = node;
                    nodes[node].physicalStrand = circle;
                    nodes[node].physicalNumOnStrand = n;
                    nodes[node].logicalNum = node;

                    const pct = loopCount === 1 ? n : n / (loopCount - 1);
                    const coordCount = nodes[node].coords.length;

                    for (let c = 0; c < coordCount; c++) {
                        if (loopCount === 1) {
                            nodes[node].coords[c].bufX = idx;
                            nodes[node].coords[c].bufY = this.insideOut ? layerSizeCount - circle - 1 : circle;
                        } else {
                            const xPos = strandLen === maxLights ? idx : Math.floor(pct * (maxLights - 1 + fudge));
                            nodes[node].coords[c].bufX = xPos;
                            nodes[node].coords[c].bufY = this.insideOut ? layerSizeCount - circle - 1 : circle;
                            idx++;
                        }
                    }

                    nodes[node].logicalX = nodes[node].coords[0].bufX;
                    nodes[node].logicalY = nodes[node].coords[0].bufY;
                    node++;
                }
                nodesToMap -= loopCount;
            }
        }

        // Set screen coordinates (circular)
        const maxRadius = maxLights / 2.0;
        const minRadius = (this.centerPercent / 100.0) * maxRadius;

        if (this.singleNode) {
            // Single node mode: distribute lights around circle
            const totalLights = nodeCount > 0 ? nodes[0].coords.length * nodeCount : 0;
            let pct = isBotToTop ? 0.5 : 0.0;
            let pctIncr = totalLights > 0 ? 1.0 / totalLights : 0;
            if (isLtoR !== isBotToTop) {
                pctIncr *= -1.0;
            }

            for (let n = 0; n < nodeCount; n++) {
                const coordCount = nodes[n].coords.length;
                for (let c = 0; c < coordCount; c++) {
                    const angle = pct * 2.0 * Math.PI;
                    nodes[n].coords[c].modelX = Math.sin(angle) * maxRadius;
                    nodes[n].coords[c].modelY = Math.cos(angle) * maxRadius;

                    pct += pctIncr;
                    if (pct >= 1.0) pct -= 1.0;
                    if (pct < 0.0) pct += 1.0;
                }
            }
        } else {
            let node = 0;
            let nodesToMap = nodeCount;

            for (let c2 = 0; c2 < layerSizeCount; c2++) {
                const circle = c2;
                const strandLen = layerSizes[layerSizeCount - circle - 1] || 0;
                const loopCount = Math.min(nodesToMap, strandLen);

                // Skip if no nodes in this layer
                if (strandLen === 0 || loopCount === 0) {
                    continue;
                }

                let radius: number;
                if (layerSizeCount === 1) {
                    radius = maxRadius;
                } else if (this.insideOut) {
                    radius = minRadius + (maxRadius - minRadius) * (1.0 - (layerSizeCount - circle - 1) / (layerSizeCount - 1));
                } else {
                    radius = minRadius + (maxRadius - minRadius) * (1.0 - circle / (layerSizeCount - 1));
                }

                for (let n = 0; n < loopCount; n++) {
                    if (node >= nodeCount) break;

                    const coordCount = nodes[node].coords.length;
                    for (let c = 0; c < coordCount; c++) {
                        let angle = (isBotToTop ? -Math.PI : 0) +
                            Math.PI * (loopCount === 1 ? c / coordCount : n / loopCount) * 2.0;
                        if (!isLtoR) {
                            angle *= -1;
                        }

                        nodes[node].coords[c].modelX = Math.sin(angle) * radius;
                        nodes[node].coords[c].modelY = Math.cos(angle) * radius;
                    }
                    node++;
                }
                nodesToMap -= loopCount;
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

export const CircleModelType: ModelType = {
    typeName: "Circle",
    displayAs: "Circle",
    modelXmlTag: 'circlemodel',
};
