import {
    NodeLoc,
    EffectBufferDescriptionInput,
    ModelProperty,
    ModelType,
    GetNodeResult,
} from "./modelbase";
import {
    defEffectBufferDescriptionOutput,
    defNodeCoord,
    defNodeLoc,
    getWorldMatrixFor2Pt,
    BaseModelClass,
    ModelChannelInfo,
} from "./modelshared";

const singleLineProperties: ModelProperty[] = [
    {name: 'SingleLineCount', ptype: "INTEGER", fieldName: 'numStrings', xmlName: 'NumStrings', description: "# Strings"},
    {name: 'SingleLineNodes', ptype: "INTEGER", fieldName: 'nodesPerString', xmlName: 'NodesPerString', description: "Nodes Per String"},
    {name: 'SingleLineLights', ptype: "INTEGER", fieldName: 'lightsPerNode', xmlName: 'LightsPerNode', description: "Lights Per Node"},
    {name: 'Dir', ptype: "STRING", fieldName: 'dir', xmlName: 'Dir', description: "Direction L/R"},
];

export class SingleLineModel extends BaseModelClass {
    modelType: ModelType = SingleLineModelType;
    numStrings: number = 1;
    nodesPerString: number = 50;
    lightsPerNode: number = 1;
    singleNode: boolean = false;
    dir: string = "L";

    constructor() {super();}

    getType(): string {
        return "SingleLine";
    }

    getProperties(): ModelProperty[] {
        return singleLineProperties;
    }

    getNumNodes() {
        // In SingleNode mode, there's one node per string
        if (this.singleNode) {
            return this.numStrings;
        }
        return this.numStrings * this.nodesPerString;
    }

    getNodeCoords(): GetNodeResult {
        const nodes: NodeLoc[] = [];
        let logicalBufferWidth = 1, logicalBufferHeight = 1, logicalBufferDepth = 1;

        const nodeCount = this.getNumNodes();
        const isLtoR = this.dir === 'L';

        // In SingleNode mode: each node has nodesPerString coords (parm2)
        // In normal mode: each node has lightsPerNode coords (parm3)
        const coordsPerNode = this.singleNode ? this.nodesPerString : this.lightsPerNode;

        // Create nodes
        for (let i = 0; i < nodeCount; ++i) {
            const nn = defNodeLoc();
            for (let c = 0; c < coordsPerNode; ++c) {
                nn.coords.push(defNodeCoord());
            }
            nodes.push(nn);
        }

        // Set buffer dimensions
        // C++: SetBufferSize(1, SingleNode ? parm1 : numLights)
        // BufferWi is parm1 (numStrings) in SingleNode mode, else numLights
        const numLights = this.numStrings * this.nodesPerString;
        logicalBufferWidth = this.singleNode ? this.numStrings : numLights;
        logicalBufferHeight = 1;

        // Assign buffer positions and logical numbers
        // All coords of a node share the same bufX (idx increments per node)
        let idx = 0;
        for (let n = 0; n < nodeCount; n++) {
            const stringNum = this.singleNode ? n : Math.floor(n / this.nodesPerString);
            const posInString = this.singleNode ? 0 : n % this.nodesPerString;

            // For channel assignment: Dir="R" means wiring starts from right
            // - Rightmost string gets first channels
            // - Within each string, rightmost position is physical pixel 0
            const physStringForChannel = /*(this.dir === 'R') ? (this.numStrings - 1 - stringNum) : */ stringNum;
            const physPosInString = (this.dir === 'R') ? (this.nodesPerString - 1 - posInString) : posInString;

            nodes[n].physicalNum = physStringForChannel * this.nodesPerString + physPosInString;
            nodes[n].physicalStrand = stringNum;
            nodes[n].physicalNumOnStrand = posInString;
            nodes[n].logicalNum = n;
            nodes[n].logicalX = idx;
            nodes[n].logicalY = 0;

            for (const c of nodes[n].coords) {
                c.bufX = idx;
                c.bufY = 0;
            }
            idx++;
        }

        // Set screen coordinates (model space)
        // C++: int lightcount = BufferWi * Nodes.front()->Coords.size()
        // C++: float bulbOffset = BufferWi / (lightcount - 1.0)
        // C++ uses float (32-bit), so we use Math.fround to match precision
        const lightCount = logicalBufferWidth * coordsPerNode;

        if (nodeCount > 0 && (logicalBufferWidth > 1 || nodes[0].coords.length > 1)) {
            // C++ uses float for bulbOffset and currentX, accumulation differs from double
            const bulbOffset = Math.fround(logicalBufferWidth / (lightCount - 1.0));
            let currentX = 0;
            for (const node of nodes) {
                for (const coord of node.coords) {
                    coord.modelX = currentX;
                    coord.modelY = 0;
                    currentX = Math.fround(currentX + bulbOffset);
                }
            }
        } else if (nodeCount > 0) {
            // 1 node 1 light - center it
            nodes[0].coords[0].modelX = 0.5;
            nodes[0].coords[0].modelY = 0;
        }

        const scaleX = logicalBufferWidth > 0 ? 1 / logicalBufferWidth : 1;
        const toWorldCoords = getWorldMatrixFor2Pt(this, scaleX);

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

    getChannelInfo(): ModelChannelInfo {
        const nodesPerString: number[] = [];
        if (this.singleNode) {
            // Single node mode: one node per string
            for (let i = 0; i < this.numStrings; i++) {
                nodesPerString.push(1);
            }
        } else {
            for (let i = 0; i < this.numStrings; i++) {
                nodesPerString.push(this.nodesPerString);
            }
        }

        return {
            name: this.name,
            startChannel: this.startChannel || '1',
            stringType: this.stringType || 'RGB Nodes',
            numStrings: this.numStrings,
            nodesPerString,
            advanced: this.advanced,
            stringStartChannels: this.stringStartChannels,
            superStringColourCount: this.superStringColours.size,
        };
    }
}

export const SingleLineModelType: ModelType = {
    typeName: "Single Line",
    displayAs: "Single Line",
    modelXmlTag: 'singlelinemodel',
};
