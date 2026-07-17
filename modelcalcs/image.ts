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

const imageProperties: ModelProperty[] = [
    {name: 'Image', ptype: "STRING", fieldName: 'imageFile', xmlName: 'Image', description: "Image file path"},
    {name: 'OffBrightness', ptype: "INTEGER", fieldName: 'offBrightness', xmlName: 'OffBrightness', description: "Off Brightness"},
    {name: 'WhiteAsAlpha', ptype: "BOOL", fieldName: 'whiteAsAlpha', xmlName: 'WhiteAsAlpha', description: "Read White As Alpha"},
    {name: 'parm1', ptype: "INTEGER", fieldName: 'parm1', xmlName: 'parm1', description: "Parameter 1"},
    {name: 'parm2', ptype: "INTEGER", fieldName: 'parm2', xmlName: 'parm2', description: "Parameter 2"},
    {name: 'parm3', ptype: "INTEGER", fieldName: 'parm3', xmlName: 'parm3', description: "Parameter 3"},
];

export class ImageModel extends BaseModelClass {
    modelType: ModelType = ImageModelType;
    imageFile: string = "";
    offBrightness: number = 80;
    whiteAsAlpha: boolean = false;
    parm1: number = 0;
    parm2: number = 0;
    parm3: number = 0;
    lightsPerNode: number = 1;
    singleNode: boolean = true;

    constructor() {super();}

    getType(): string {
        return "Image";
    }

    getProperties(): ModelProperty[] {
        return imageProperties;
    }

    getNumNodes() {
        // Image model always has exactly 1 node
        return 1;
    }

    getNodeCoords(): GetNodeResult {
        const nodes: NodeLoc[] = [];
        const logicalBufferWidth = 1;
        const logicalBufferHeight = 1;
        const logicalBufferDepth = 1;

        // Create single node with two coords for bounding box selection
        const nn = defNodeLoc();

        // First coord at -0.5, -0.5 for selection area
        const coord1 = defNodeCoord();
        coord1.bufX = 0;
        coord1.bufY = 0;
        coord1.modelX = -0.5;
        coord1.modelY = -0.5;
        coord1.modelZ = -0.5;
        nn.coords.push(coord1);

        // Second coord at 0.5, 0.5 for selection area (like C++)
        const coord2 = defNodeCoord();
        coord2.bufX = 0;
        coord2.bufY = 0;
        coord2.modelX = 0.5;
        coord2.modelY = 0.5;
        coord2.modelZ = 0.5;
        nn.coords.push(coord2);

        nn.physicalNum = 0;
        nn.physicalStrand = 0;
        nn.physicalNumOnStrand = 0;
        nn.logicalNum = 0;
        nn.logicalX = 0;
        nn.logicalY = 0;

        nodes.push(nn);

        // Use boxed screen location like C++
        const toWorldCoords = getWorldMatrixForBoxed(this);

        return {
            toWorldCoords,
            toWorld2DCoords: toWorldCoords,
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

export const ImageModelType: ModelType = {
    typeName: "Image",
    displayAs: "Image",
    modelXmlTag: 'imagemodel',
};
