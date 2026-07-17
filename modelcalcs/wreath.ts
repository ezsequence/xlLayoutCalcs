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

const wreathProperties: ModelProperty[] = [
    {name: 'WreathStringCount', ptype: "INTEGER", fieldName: 'numStrings', xmlName: 'NumStrings', description: "# Strings"},
    {name: 'WreathLightCount', ptype: "INTEGER", fieldName: 'nodesPerString', xmlName: 'NodesPerString', description: "Nodes Per String"},
    {name: 'parm3', ptype: "INTEGER", fieldName: 'parm3', xmlName: 'parm3', description: "Parameter 3 (unused)"},
    {name: 'Dir', ptype: "STRING", fieldName: 'dir', xmlName: 'Dir', description: "Direction L/R"},
    {name: 'StartSide', ptype: "STRING", fieldName: 'startSide', xmlName: 'StartSide', description: "Start Side T/B"},
];

export class WreathModel extends BaseModelClass {
    modelType: ModelType = WreathModelType;
    numStrings: number = 1;
    nodesPerString: number = 50;
    parm3: number = 0;  // Present in XML but not used by wreath model
    lightsPerNode: number = 1;
    singleNode: boolean = false;
    dir: string = "L";
    startSide: string = "T";

    constructor() {super();}

    getType(): string {
        return "Wreath";
    }

    getProperties(): ModelProperty[] {
        return wreathProperties;
    }

    getNumNodes() {
        if (this.singleNode) {
            return this.numStrings;  // One node per string in single node mode
        }
        return this.numStrings * this.nodesPerString;
    }

    getNodeCoords(): GetNodeResult {
        const nodes: NodeLoc[] = [];
        let logicalBufferWidth = 1, logicalBufferHeight = 1, logicalBufferDepth = 1;

        const numLights = this.numStrings * this.nodesPerString;
        const isBotToTop = this.startSide === 'B';
        const isLtoR = this.dir === 'L';

        if (this.singleNode) {
            // Single node mode: one node per string, all lights as coords
            // C++ still uses full circular buffer, each node has coords at circular positions
            const nodeCount = this.numStrings;
            const lightsPerString = this.nodesPerString * this.lightsPerNode;

            // Create nodes
            for (let i = 0; i < nodeCount; ++i) {
                const nn = defNodeLoc();
                for (let c = 0; c < lightsPerString; ++c) {
                    nn.coords.push(defNodeCoord());
                }
                nodes.push(nn);
            }

            // Buffer is still the full circular buffer (same as normal mode)
            // C++: SetBufferSize(numlights+1, numlights+1)
            logicalBufferWidth = numLights + 1;
            logicalBufferHeight = numLights + 1;

            // C++: int offset = numlights / 2 (integer division)
            const offset = Math.floor(numLights / 2);
            const r = offset;

            // C++: CopyBufCoord2ScreenCoord uses BufferWi/2 and BufferHt/2
            const screenXOffset = Math.floor(logicalBufferWidth / 2);
            const screenYOffset = Math.floor(logicalBufferHeight / 2);

            // pct = % of circle, 0=top
            let pct = isBotToTop ? 0.5 : 0.0;
            let pctIncr = 1.0 / numLights;
            if (isLtoR !== isBotToTop) {
                pctIncr *= -1.0;
            }

            // Assign coordinates - coords placed around circle like normal mode
            for (let n = 0; n < nodeCount; n++) {
                nodes[n].physicalNum = n;
                nodes[n].physicalStrand = n;
                nodes[n].physicalNumOnStrand = 0;
                nodes[n].logicalNum = n;

                const coordCount = nodes[n].coords.length;
                for (let c = 0; c < coordCount; c++) {
                    // Buffer coords: circular, same formula as normal mode
                    // C++: x = r*sin(pct*2.0*M_PI) + offset + 0.5 (assigned to int, truncates)
                    const x = Math.trunc(r * Math.sin(pct * 2.0 * Math.PI) + offset + 0.5);
                    const y = Math.trunc(r * Math.cos(pct * 2.0 * Math.PI) + offset + 0.5);

                    nodes[n].coords[c].bufX = x;
                    nodes[n].coords[c].bufY = y;

                    // Model coordinates derived from buffer coords (matches C++ CopyBufCoord2ScreenCoord)
                    nodes[n].coords[c].modelX = x - screenXOffset;
                    nodes[n].coords[c].modelY = y - screenYOffset;

                    pct += pctIncr;
                    if (pct >= 1.0) pct -= 1.0;
                    if (pct < 0.0) pct += 1.0;
                }

                // Set logical coords to first coord's buffer position
                nodes[n].logicalX = nodes[n].coords[0].bufX;
                nodes[n].logicalY = nodes[n].coords[0].bufY;
            }
        } else {
            // Normal mode
            const nodeCount = this.numStrings * this.nodesPerString;

            // Create nodes
            for (let i = 0; i < nodeCount; ++i) {
                const nn = defNodeLoc();
                for (let c = 0; c < this.lightsPerNode; ++c) {
                    nn.coords.push(defNodeCoord());
                }
                nodes.push(nn);
            }

            // Buffer is a square that can contain the circle
            // C++: SetBufferSize(numlights+1, numlights+1)
            logicalBufferWidth = numLights + 1;
            logicalBufferHeight = numLights + 1;

            // C++: int offset = numlights / 2 (integer division)
            const offset = Math.floor(numLights / 2);
            const r = offset;

            // C++: CopyBufCoord2ScreenCoord uses BufferWi/2 and BufferHt/2
            // BufferWi = BufferHt = numLights + 1
            const screenXOffset = Math.floor(logicalBufferWidth / 2);
            const screenYOffset = Math.floor(logicalBufferHeight / 2);

            // pct = % of circle, 0=top
            let pct = isBotToTop ? 0.5 : 0.0;
            // cw or ccw
            let pctIncr = 1.0 / numLights;
            if (isLtoR !== isBotToTop) {
                pctIncr *= -1.0;
            }

            // Assign coordinates
            for (let n = 0; n < nodeCount; n++) {
                nodes[n].physicalNum = n;
                nodes[n].physicalStrand = Math.floor(n / this.nodesPerString);
                nodes[n].physicalNumOnStrand = n % this.nodesPerString;
                nodes[n].logicalNum = n;

                const coordCount = nodes[n].coords.length;
                for (let c = 0; c < coordCount; c++) {
                    // C++: x = r*sin(pct*2.0*M_PI) + offset + 0.5 (assigned to int, truncates)
                    // Using Math.trunc to match C++ truncation toward zero
                    const x = Math.trunc(r * Math.sin(pct * 2.0 * Math.PI) + offset + 0.5);
                    const y = Math.trunc(r * Math.cos(pct * 2.0 * Math.PI) + offset + 0.5);

                    nodes[n].coords[c].bufX = x;
                    nodes[n].coords[c].bufY = y;
                    nodes[n].logicalX = x;
                    nodes[n].logicalY = y;

                    // Model coordinates derived from buffer coords (matches C++ CopyBufCoord2ScreenCoord)
                    // C++: screenX = bufX - xoffset; screenY = bufY - yoffset;
                    nodes[n].coords[c].modelX = x - screenXOffset;
                    nodes[n].coords[c].modelY = y - screenYOffset;

                    pct += pctIncr;
                    if (pct >= 1.0) pct -= 1.0;
                    if (pct < 0.0) pct += 1.0;
                }
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

export const WreathModelType: ModelType = {
    typeName: "Wreath",
    displayAs: "Wreath",
    modelXmlTag: 'wreathmodel',
};
