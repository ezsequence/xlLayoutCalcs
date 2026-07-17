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

const windowFrameProperties: ModelProperty[] = [
    {name: 'WFTopCount', ptype: "INTEGER", fieldName: 'topCount', xmlName: 'TopNodes', description: "# Lights Top"},
    {name: 'WFLeftRightCount', ptype: "INTEGER", fieldName: 'leftRightCount', xmlName: 'SideNodes', description: "# Lights Left/Right"},
    {name: 'WFBottomCount', ptype: "INTEGER", fieldName: 'bottomCount', xmlName: 'BottomNodes', description: "# Lights Bottom"},
    {name: 'Rotation', ptype: "STRING", fieldName: 'rotation', xmlName: 'Rotation', description: "Direction"},
    {name: 'Dir', ptype: "STRING", fieldName: 'dir', xmlName: 'Dir', description: "Direction L/R"},
    {name: 'StartSide', ptype: "STRING", fieldName: 'startSide', xmlName: 'StartSide', description: "Start Side T/B"},
];

export class WindowFrameModel extends BaseModelClass {
    modelType: ModelType = WindowFrameModelType;
    topCount: number = 10;
    leftRightCount: number = 10;
    bottomCount: number = 10;
    lightsPerNode: number = 1;
    singleNode: boolean = false;
    rotation: string = "CW";
    dir: string = "L";
    startSide: string = "T";

    constructor() {super();}

    getType(): string {
        return "WindowFrame";
    }

    getProperties(): ModelProperty[] {
        return windowFrameProperties;
    }

    getNumNodes() {
        if (this.singleNode) {
            return 1;  // One node in single node mode
        }
        return this.topCount + 2 * this.leftRightCount + this.bottomCount;
    }

    getNodeCoords(): GetNodeResult {
        const nodes: NodeLoc[] = [];

        const left = this.leftRightCount;
        const top = this.topCount;
        const bottom = this.bottomCount;

        const width = Math.max(top, bottom) + 2;
        const height = this.leftRightCount;
        const totalLights = top + 2 * left + bottom;
        const nodeCount = this.getNumNodes();

        let logicalBufferWidth = width;
        let logicalBufferHeight = height;

        if (left + top + bottom === 0) {
            const toWorldCoords = getWorldMatrixForBoxed(this);
            return { toWorldCoords, toWorld2DCoords: toWorldCoords, logicalBufferWidth, logicalBufferHeight, logicalBufferDepth: 1, nodes };
        }

        // Create nodes
        if (this.singleNode) {
            // Single node mode: one node with all lights as coords
            const nn = defNodeLoc();
            for (let c = 0; c < totalLights; ++c) {
                nn.coords.push(defNodeCoord());
            }
            nodes.push(nn);
            // Buffer is 1x1 for single node mode
            logicalBufferWidth = 1;
            logicalBufferHeight = 1;
        } else {
            for (let i = 0; i < nodeCount; ++i) {
                const nn = defNodeLoc();
                nn.coords.push(defNodeCoord());
                nodes.push(nn);
            }
        }

        const isLtoR = this.dir === 'L';
        const isBotToTop = this.startSide === 'B';
        const clockwise = this.rotation === "Clockwise" || this.rotation === "CW";
        const dir = clockwise ? 1.0 : -1.0;

        let wadj = 0;
        let hadj = 0;
        if (dir === -1) {
            if ((isBotToTop && isLtoR) || (!isBotToTop && !isLtoR)) {
                wadj = 2;
                hadj = -2;
            }
        } else {
            if ((!isBotToTop && isLtoR) || (isBotToTop && !isLtoR)) {
                wadj = 2;
                hadj = -2;
            }
        }

        let top_screenincr = 1;
        if (top + wadj - 1 !== 0) top_screenincr = width / (top + 1);
        let bot_screenincr = 1;
        if (bottom + wadj - 1 !== 0) bot_screenincr = -1.0 * width / (bottom + 1);

        let top_incr = 1;
        if (top === 0) top_incr = width - 1;
        else if (top + wadj + 1 !== 0) top_incr = (width + wadj) / (top + wadj + 1);

        let bot_incr = 1;
        if (bottom === 0) bot_incr = -(width - 1);
        else if (bottom + wadj + 1 !== 0) bot_incr = -1.0 * (width + wadj) / (bottom + wadj + 1);

        const lengths = [left + hadj, top + wadj, left + hadj, bottom + wadj];
        const xscreenincr = [0, top_screenincr, 0, bot_screenincr];
        const yscreenincr = [1, 0, -1, 0];
        const xincr = [0, top_incr, 0, bot_incr];
        const yincr = [1, 0, -1, 0];
        const xStart: number[] = [0, 0, 0, 0];
        const yStart: number[] = [0, 0, 0, 0];
        const xScreenStart: number[] = [0, 0, 0, 0];
        const yScreenStart: number[] = [0, 0, 0, 0];
        const indexes = [0, 1, 2, 3];

        if (dir === -1) {
            if ((isBotToTop && isLtoR) || (!isBotToTop && !isLtoR)) {
                xStart[0] = 0;
                xStart[1] = width - 1;
                xStart[2] = width - 1;
                xStart[3] = 0;
                yStart[0] = height - 2;
                yStart[1] = height - 1;
                yStart[2] = 1;
                yStart[3] = 0;

                xScreenStart[0] = -width / 2.0;
                xScreenStart[1] = width / 2.0;
                xScreenStart[2] = xScreenStart[1];
                xScreenStart[3] = xScreenStart[0];
                yScreenStart[0] = (height - 1) / 2.0 - 1.0;
                yScreenStart[1] = (height - 1) / 2.0;
                yScreenStart[2] = -(height - 1) / 2.0 + 1.0;
                yScreenStart[3] = -(height - 1) / 2.0;
            } else {
                xStart[0] = 0;
                xStart[1] = width - 2;
                xStart[2] = width - 1;
                xStart[3] = 1;
                yStart[0] = height - 1;
                yStart[1] = height - 1;
                yStart[2] = 0;
                yStart[3] = 0;

                xScreenStart[0] = -width / 2.0;
                xScreenStart[1] = width / 2.0 - top_screenincr;
                xScreenStart[2] = width / 2.0;
                xScreenStart[3] = xScreenStart[0] - bot_screenincr;
                yScreenStart[0] = (height - 1) / 2.0;
                yScreenStart[1] = (height - 1) / 2.0;
                yScreenStart[2] = -(height - 1) / 2.0;
                yScreenStart[3] = -(height - 1) / 2.0;
            }
        } else {
            if ((!isBotToTop && isLtoR) || (isBotToTop && !isLtoR)) {
                xStart[0] = 0;
                xStart[1] = 0;
                xStart[2] = width - 1;
                xStart[3] = width - 1;
                yStart[0] = 1;
                yStart[1] = height - 1;
                yStart[2] = height - 2;
                yStart[3] = 0;

                xScreenStart[0] = -width / 2.0;
                xScreenStart[1] = xScreenStart[0];
                xScreenStart[2] = width / 2.0;
                xScreenStart[3] = xScreenStart[2];
                yScreenStart[0] = -(height - 1) / 2.0 + 1;
                yScreenStart[1] = (height - 1) / 2.0;
                yScreenStart[2] = (height - 1) / 2.0 - 1;
                yScreenStart[3] = -(height - 1) / 2.0;
            } else {
                xStart[0] = 0;
                xStart[1] = 1;
                xStart[2] = width - 1;
                xStart[3] = width - 2;
                yStart[0] = 0;
                yStart[1] = height - 1;
                yStart[2] = height - 1;
                yStart[3] = 0;

                xScreenStart[0] = -width / 2;
                xScreenStart[1] = -width / 2 + top_screenincr;
                xScreenStart[2] = width / 2;
                xScreenStart[3] = width / 2 + bot_screenincr;
                yScreenStart[0] = -(height - 1) / 2;
                yScreenStart[1] = (height - 1) / 2;
                yScreenStart[2] = (height - 1) / 2;
                yScreenStart[3] = -(height - 1) / 2;
            }
        }

        // Determine index order based on start location and rotation
        if (isLtoR) {
            if (isBotToTop) {
                // Bottom left
                if (dir === 1.0) {
                    indexes[0] = 0; indexes[1] = 1; indexes[2] = 2; indexes[3] = 3;
                } else {
                    indexes[0] = 3; indexes[1] = 2; indexes[2] = 1; indexes[3] = 0;
                }
            } else {
                // Top left
                if (dir === 1.0) {
                    indexes[0] = 1; indexes[1] = 2; indexes[2] = 3; indexes[3] = 0;
                } else {
                    indexes[0] = 0; indexes[1] = 3; indexes[2] = 2; indexes[3] = 1;
                }
            }
        } else {
            if (isBotToTop) {
                // Bottom right
                if (dir === 1.0) {
                    indexes[0] = 3; indexes[1] = 0; indexes[2] = 1; indexes[3] = 2;
                } else {
                    indexes[0] = 2; indexes[1] = 1; indexes[2] = 0; indexes[3] = 3;
                }
            } else {
                // Top right
                if (dir === 1.0) {
                    indexes[0] = 2; indexes[1] = 3; indexes[2] = 0; indexes[3] = 1;
                } else {
                    indexes[0] = 1; indexes[1] = 0; indexes[2] = 3; indexes[3] = 2;
                }
            }
        }

        let side = 0;
        while (lengths[indexes[side]] === 0) side++;

        let x = xStart[indexes[side]];
        let y = yStart[indexes[side]];
        let screenx = xScreenStart[indexes[side]];
        let screeny = yScreenStart[indexes[side]];
        let curLen = lengths[indexes[side]];

        // In single node mode: nd=0 always, cd iterates through coords
        // In normal mode: nd iterates through nodes, cd=0 always
        let nd = 0;
        let cd = 0;
        const loops = this.singleNode ? totalLights : nodeCount;

        // Set up node metadata
        if (this.singleNode) {
            nodes[0].physicalNum = 0;
            nodes[0].logicalNum = 0;
            nodes[0].logicalX = 0;
            nodes[0].logicalY = 0;
        }

        for (let n = 0; n < loops; n++) {
            if (!this.singleNode) {
                nodes[nd].physicalNum = nd;
                nodes[nd].logicalNum = nd;
            }

            if (this.singleNode) {
                // In single node mode, all buffer coords are 0
                nodes[nd].coords[cd].bufX = 0;
                nodes[nd].coords[cd].bufY = 0;
            } else {
                const bufX = xincr[indexes[side]] * dir > 0 ? Math.floor(x) : Math.ceil(x);
                nodes[nd].coords[cd].bufX = bufX;
                nodes[nd].coords[cd].bufY = y;
                nodes[nd].logicalX = bufX;
                nodes[nd].logicalY = y;
            }

            // Model coordinates follow frame geometry in both modes
            nodes[nd].coords[cd].modelX = screenx;
            nodes[nd].coords[cd].modelY = screeny;

            screenx = screenx + (xscreenincr[indexes[side]] * dir);
            screeny = screeny + (yscreenincr[indexes[side]] * dir);
            x = x + xincr[indexes[side]] * dir;
            y = y + yincr[indexes[side]] * dir;
            curLen--;

            if (curLen <= 0) {
                side++;
                if (side >= 4) side = 0;
                while (lengths[indexes[side]] === 0) {
                    side++;
                    if (side >= 4) side = 0;
                }
                x = xStart[indexes[side]];
                y = yStart[indexes[side]];
                screenx = xScreenStart[indexes[side]];
                screeny = yScreenStart[indexes[side]];
                curLen = lengths[indexes[side]];
            }

            // Advance node/coord index
            if (this.singleNode) {
                cd++;
            } else {
                nd++;
            }
        }

        const toWorldCoords = getWorldMatrixForBoxed(this);

        return {
            toWorldCoords,
            toWorld2DCoords: toWorldCoords, // 2D model, no perspective needed
            logicalBufferWidth,
            logicalBufferHeight,
            logicalBufferDepth: 1,
            nodes,
        };
    }

    getBufferDescription(ind: EffectBufferDescriptionInput) {
        const ebdo = defEffectBufferDescriptionOutput();
        return ebdo;
    }
}

export const WindowFrameModelType: ModelType = {
    typeName: "Window Frame",
    displayAs: "Window Frame",
    modelXmlTag: 'windowframemodel',
};
