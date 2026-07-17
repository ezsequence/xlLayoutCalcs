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
    getWorldMatrixFor3Pt,
    BaseModelClass,
    ModelChannelInfo,
} from "./modelshared";

import { rotatePoint, toRadians } from "./utils";

const archProperties: ModelProperty[] = [
    {name: 'LayerSizes', ptype: "NODE_ARRAY", fieldName: 'layerSizes', xmlName: "LayerSizes", description: "Layer Sizes"},
    {name: 'ArchesCount', ptype: "INTEGER", fieldName: 'archesCount', xmlName: 'NumArches', description: "# Arches"},
    {name: 'ArchesNodes', ptype: "INTEGER", fieldName: 'nodesPerArch', xmlName: 'NodesPerArch', description: "Nodes Per Arch"},
    {name: 'ArchesArc', ptype: "FLOAT", fieldName: 'arc', xmlName: 'Arc', description: "Arc Degrees"},
    {name: 'ArchesHeight', ptype: "FLOAT", fieldName: 'height', xmlName: 'Height', description: "Height to width ratio"},
    {name: 'ArchesSkew', ptype: "FLOAT", fieldName: 'skew', xmlName: 'ArchesSkew', description: "Arch Tilt"}, // Legacy attribute name
    {name: 'Angle', ptype: "FLOAT", fieldName: 'skew', xmlName: 'Angle', description: "Arch Tilt"}, // Comes from 3rd handle
    {name: 'ArchesLights', ptype: "INTEGER", fieldName: 'lightsPerNode', xmlName: 'LightsPerNode', description: "Lights Per Node"},
    {name: 'ArchesHollow', ptype: "FLOAT", fieldName: 'hollow', xmlName: 'Hollow', description: "Hollow %"},
    {name: 'ArchesZigZag', ptype: "BOOL", fieldName: 'zigzag', xmlName: 'ZigZag', description: "Zig Zag Layers"},
    {name: 'ArchesGap', ptype: "INTEGER", fieldName: 'gap', xmlName: 'Gap', description: "Gap Between Arches"},
    {name: 'SingleNode', ptype: "BOOL", fieldName: 'singleNode', xmlName: 'SingleNode', description: "Single Node - for dumb strings"},
    {name: 'Dir', ptype: "STRING", fieldName: 'dir', xmlName: 'Dir', description: "Direction L/R"}, // L/R
    {name: 'StartSide', ptype: "STRING", fieldName: 'startSide', xmlName: 'StartSide', description: "Start Side T/B"}, // T/B
];

// An Arch is a 3-point screen location: start and end point handles, plus a
// third handle controlling height/shear (with RotateX):
//   WorldPos            -> point 1
//   WorldPos + X2/Y2/Z2 -> point 2
//   center is between those.
export class ArchModel extends BaseModelClass {
    modelType: ModelType = ArchModelType;
    archesCount: number = 1;
    nodesPerArch: number = 50;
    lightsPerNode: number = 1;
    singleNode: boolean = false;
    hollow: number = 70;
    skew: number = 0;
    // x2026_3 semantics: absent ZigZag means false (upstream only writes it
    // when true). x2026_2 files, where absent meant true, get an explicit
    // ZigZag="true" materialized by normalizeModelElementForward before
    // binding — so this default only ever applies to genuine x2026_3 input.
    zigzag: boolean = false;
    gap: number = 0;
    arc: number = 180;
    height: number = 1;
    dir: string = "L";
    startSide: string = "T";
    layerSizes: number[] = [];

    constructor() {super();}

    getType(): string {
        return "Arch";
    }

    getProperties(): ModelProperty[] {
        return archProperties;
    }

    isLayered() {
        return this.layerSizes.length > 0;
    }

    // Number of nodes, not coords (each node carries lightsPerNode coords).
    // Note: SingleNode no longer collapses to one node per arch — xLights's
    // ArchesModel.cpp:83 keeps SetNodeCount(NumArches * SegmentsPerArch, ...)
    // even in SingleNode mode (only the channels-per-node drops to 1).  We
    // match that: per-pixel nodes regardless of singleNode.
    getNumNodes() {
        if (this.isLayered()) {
            let nn = 0;
            for (const n of this.layerSizes) {
                nn += n;
            }
            return nn;
        }
        return this.archesCount * this.nodesPerArch;
    }

    getNodeCoords(): GetNodeResult {
        const nodes: NodeLoc [] = [];
        let scaleX = 1, scaleY = 1, scaleZ = 1;
        let logicalBufferHeight = 1, logicalBufferWidth = 1, logicalBufferDepth = 1;
        let numStrings = 1;
        let nodesPerString = 1;

        // Compute nodes and coords in their render buffer locations
        //  Also do our best to assign physical numbers.
        // SingleNode no longer takes a special branch — per xLights
        // ArchesModel.cpp:81-92 the buffer/node grid is identical between
        // SingleNode and non-SingleNode (only the channels-per-node count
        // changes, which is handled by string-type-aware channel allocation
        // elsewhere).  Always create per-pixel nodes here.
        const nodeCount = this.getNumNodes();
        for (let i = 0; i < nodeCount; ++i) {
            const nn = defNodeLoc();
            for (let c = 0; c < this.lightsPerNode; ++c) {
                nn.coords.push(defNodeCoord());
            }
            nodes.push(nn);
        }

        if (this.isLayered()) {
            let maxLayerLen = 0;
            let layerCount = 0;
            let totNodes = 0;

            const layerStarts = [];

            for (const ls of this.layerSizes) {
                layerStarts.push(totNodes);
                maxLayerLen = Math.max(maxLayerLen, ls);
                layerCount++;
                totNodes += ls;
            }

            logicalBufferHeight = layerCount;
            logicalBufferWidth = maxLayerLen;

            numStrings = 1;
            nodesPerString = this.nodesPerArch;

            //screenLocation.SetRenderSize(maxLen, 1);
    
            let idx = 0;
            let dir = this.dir === 'L';
            const inOut = this.startSide === 'B';

            for (let layer = 0; layer < layerCount; layer++) {
                const physLayer = inOut ? layerCount - layer - 1 : layer;
                const lcount = this.layerSizes[physLayer];
                if (idx >= nodes.length) continue; // Defensive: layerSizes may sum past the node count

                if (lcount == 1) {
                    // Channels are assigned by the channel allocator, not here.
                    nodes[idx].physicalNum = idx;
                    nodes[idx].physicalStrand = physLayer;
                    nodes[idx].physicalNumOnStrand = 0;
                    nodes[idx].logicalNum = layerStarts[physLayer];
                    nodes[idx].logicalY = layer;
                    nodes[idx].logicalX = 0;

                    for (const c of nodes[idx].coords) {
                        c.bufX = maxLayerLen / 2;
                        c.bufY = physLayer;
                    }
                    ++idx;
                } else {
                    const gap = (maxLayerLen - 1) / (lcount - 1);
                    for (let x = 0; x < lcount; x++) {
                        if (idx >= nodes.length) continue; // Defensive: layerSizes may sum past the node count

                        const logicalX = Math.round(x * gap);
                        const physX = dir ? logicalX : maxLayerLen - 1 - logicalX;
                        const logNum = dir ? x : lcount - 1 - x;

                        nodes[idx].physicalNum = idx;
                        nodes[idx].physicalStrand = physLayer;
                        nodes[idx].physicalNumOnStrand = x;
                        nodes[idx].logicalY = layer;
                        nodes[idx].logicalX = logicalX;
                        nodes[idx].logicalNum = layerStarts[physLayer] + logNum;

                        for (const c of nodes[idx].coords) {
                            c.bufX = physX;
                            c.bufY = physLayer;
                        }
                        ++idx;
                    }
                }
                if (this.zigzag) dir = !dir;
            }

            const midpt = ((maxLayerLen * this.lightsPerNode) - 1) / 2;
            const radians = toRadians(this.arc);
            const start = (Math.PI - radians) / 2.0;
            const skewAngle = toRadians(this.skew);
            const width = maxLayerLen * this.lightsPerNode + midpt * Math.sin(radians / 2) * 2.0; // xLights' width formula — an approximation, replicated exactly

            const layerGap = layerCount > 1 ? (1.0 - this.hollow / 100.0) / (layerCount - 1) : 0;  // Gap between layers, 0-1

            let minY = Number.MAX_VALUE; // Will use to trim the bottom off
            
            // Screen coords are derived from each node's buffer position
            // (bufX/bufY) rather than by walking strands in order — matches xLights.
            for (let n = 0; n < nodeCount; n++) {
                const coordCount = nodes[n].coords.length;
                const radius = 1.0 - layerGap * (layerCount - 1 - nodes[n].coords[0].bufY);
                const locsPerLayer = maxLayerLen * this.lightsPerNode;
                for (let c = 0; c < coordCount; c++) {
                    const proportion = locsPerLayer <= 1 ? .5 : (nodes[n].coords[c].bufX * this.lightsPerNode + c) / (locsPerLayer-1);
                    const angle2 = start + proportion * radians - Math.PI/2; // -PI/2 shifts the angle origin to match xLights
                    const x = Math.sin(angle2) * radius * midpt * 2 + maxLayerLen * this.lightsPerNode;
                    const yForWeirdMinCalc = Math.cos(angle2) * maxLayerLen * this.lightsPerNode;
                    const y = yForWeirdMinCalc * this.height * radius;
                    // This is a skew not a rotate because it is centered on its own X, not model X
                    const rcs = rotatePoint(x, 0, skewAngle, x, y);
                    nodes[n].coords[c].modelX = rcs.x;
                    nodes[n].coords[c].modelY = rcs.y;
                    minY = Math.min(minY, yForWeirdMinCalc);
                }
            }

            // Upstream quirks, replicated: skew moves the top of the arch when
            // the arc is not 180°, and small arc angles are not centered.
            let renderHt = (this.nodesPerArch * this.lightsPerNode); // xLights' renderHt formula, replicated as-is
            if (minY > 0) {
                renderHt -= minY;
                for (const n of nodes) {
                    for (const c of n.coords) {
                        c.modelY -= minY;
                    }
                }
            }

            scaleX = width > 0 ? 1/width : 1;
            scaleY = renderHt ? 1/renderHt : 1;
        }
        else {
            const numArches = this.archesCount;
            const segmentsPerArch = this.nodesPerArch;
    
            logicalBufferWidth = segmentsPerArch;
            logicalBufferHeight = numArches;

            if (this.singleNode) {
                numStrings = numArches * segmentsPerArch;
                nodesPerString = this.lightsPerNode;
            } else {
                numStrings = numArches; // TODO: Shouldn't it be strands?
                nodesPerString = segmentsPerArch;
            }
            //screenLocation.SetRenderSize(SegmentsPerArch, NumArches);
    
            const scaleup = this.nodesPerArch * this.lightsPerNode;
            const midpt = (scaleup - 1) / 2.0;
            const radians = toRadians(this.arc);
            const skewAngle = toRadians(this.skew);
            const start = -radians / 2.0;
            const width = scaleup + midpt * Math.sin(radians / 2) * 2.0; // xLights' width formula — an approximation, replicated exactly

            for (let y = 0; y < numArches; y++) {
                for (let x = 0; x < segmentsPerArch; x++) {
                    const idx = y * segmentsPerArch + x;

                    // Physical wiring order depends on Dir
                    // Dir="R" means controller is on right (blue square), so:
                    // - Arches are wired in reverse order (rightmost arch first)
                    // - Within each arch, right side is physical pixel 0
                    const physArchForChannel = (this.dir === 'R') ? (numArches - 1 - y) : y;
                    const physPosInArch = (this.dir === 'R') ? (segmentsPerArch - 1 - x) : x;

                    nodes[idx].physicalStrand = y;  // Keep y for coordinate calculations
                    nodes[idx].physicalNumOnStrand = x;  // Keep x for coordinate calculations
                    nodes[idx].physicalNum = physArchForChannel * segmentsPerArch + physPosInArch;
                    nodes[idx].logicalNum = idx;
                    nodes[idx].logicalY = y;
                    nodes[idx].logicalX = x;

                    for (const c of nodes[idx].coords) {
                        c.bufX = x;
                        c.bufY = y;
                    }
                }
            }

            let minY = Number.MAX_VALUE; // Will use to trim the bottom off
            let gaps = 0;

            for (let n = 0; n < nodeCount; ++n) {
                const xoffset = nodes[n].physicalStrand * width;
                const coordCount = nodes[n].coords.length;
                for (let c = 0; c < coordCount; c++) {
                    const proportion = midpt === 0 ? .5 : (nodes[n].coords[c].bufX * this.lightsPerNode + c) / (midpt * 2);
                    const angle2 = start + radians * proportion; // top pointed right
                    const x = xoffset + midpt * 2.0 * Math.sin(angle2) + scaleup + gaps * this.gap;

                    // This is a skew not a rotate because it is centered on its own X, not model X
                    const yForWeirdMinCalc = Math.cos(angle2) * scaleup;
                    const rcs = rotatePoint(x, 0, skewAngle, x, yForWeirdMinCalc * this.height);
                    nodes[n].coords[c].modelX = rcs.x;
                    nodes[n].coords[c].modelY = rcs.y;
                    minY = Math.min(minY, yForWeirdMinCalc);
                }
                if ((n + 1) % this.nodesPerArch == 0) {
                    ++gaps;
                }
            }

            // Upstream quirks, replicated: skew moves the top of the arch when
            // the arc is not 180°, and small arc angles are not centered.
            if (minY > 0) {
                //renderHt -= minY;
                for (const n of nodes) {
                    for (const c of n.coords) {
                        c.modelY -= minY;
                    }
                }
            }

            scaleX = 1/(width * numArches + (numArches - 1) * this.gap);
            //scaleY = 1/scaleup;
        }

        const toWorldCoords = getWorldMatrixFor3Pt(this, scaleX);

        return {
            toWorldCoords,
            toWorld2DCoords: toWorldCoords, // 2D model, no perspective needed
            logicalBufferWidth,
            logicalBufferHeight,
            logicalBufferDepth,
            //numStrings,
            //nodesPerString,
            nodes,
        };
    }

    getBufferDescription(ind: EffectBufferDescriptionInput) {
        const ebdo = defEffectBufferDescriptionOutput();
        if (ind.style === "Default") {
            // TODO: layered arch buffer style
        }
        else if (ind.style === "Single Line") {
            // TODO: Single Line buffer style
        }
        return ebdo;
    }

    getChannelInfo(): ModelChannelInfo {
        let numStrings: number;
        let nodesPerString: number[];

        // SingleNode does not change the node count, only the channels-per-node
        // (which the string-type-aware allocator handles).  Same logic as
        // xLights ArchesModel.cpp:81-85.
        if (this.isLayered()) {
            // Layered arch: each layer is a string
            numStrings = this.layerSizes.length;
            nodesPerString = [...this.layerSizes];
        } else {
            // Regular arches: each arch is a string
            numStrings = this.archesCount;
            nodesPerString = [];
            for (let i = 0; i < numStrings; i++) {
                nodesPerString.push(this.nodesPerArch);
            }
        }

        return {
            name: this.name,
            startChannel: this.startChannel || '1',
            stringType: this.stringType || 'RGB Nodes',
            numStrings,
            nodesPerString,
            advanced: this.advanced,
            stringStartChannels: this.stringStartChannels,
            superStringColourCount: this.superStringColours.size,
        };
    }

    // Node data of interest here:
    //  - node locations (the primary output)
    //  - buffer locations (approximate significance)
    //  - string/number/port assignment is handled by the channel allocator
    //  - a node may carry more than one visual point (lightsPerNode coords)
}

export const ArchModelType: ModelType = {
    typeName: "Arches",
    displayAs: "Arches",
    modelXmlTag: 'archesmodel',
    // TODO: Some way to capture that it is 2-point, with rot X and angle.
};


// Strand/wiring notes (per xLights ArchesModel):
//  - A strand is a layer when the arch is layered (with strand order
//    reversed, per upstream GetMappedStrand), otherwise one arch.
//  - Nodes are numbered in wiring order: string, then position on string.
//  - Default buffer is arches (Y) x nodes per arch (X); layered arches use
//    the layers instead.
//  - SingleNode ("dumb"/single-channel strings) changes only channels per
//    node, never the node grid — see getNumNodes / getChannelInfo.