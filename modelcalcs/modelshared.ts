import { vec3, mat4 } from "gl-matrix";
import { BaseModel, ModelProperty, GetNodeResult, EffectBufferDescriptionInput, EffectBufferDescriptionOutput, NodeLoc, NodeCoord, NodeColorProfile } from "./modelbase";

/**
 * Channel-relevant information extracted from a model.
 * Used by the channel resolution system.
 */
export interface ModelChannelInfo {
    name: string;
    startChannel: string;
    stringType: string;
    numStrings: number;
    nodesPerString: number[];
    advanced: boolean;
    stringStartChannels: Map<number, string>;
    superStringColourCount: number;  // Number of colours in a superstring (0 if not superstring)
}

export abstract class BaseModelClass implements BaseModel {
    abstract getProperties(): ModelProperty[];
    abstract getNumNodes(): number;
    abstract getNodeCoords(): GetNodeResult;
    abstract getBufferDescription(ind: EffectBufferDescriptionInput): EffectBufferDescriptionOutput;
    abstract getType(): string;

    name: string = '<unnamed>';
    displayAs: string = '';
    locked: boolean = false;
    active: boolean = true;
    fromBase: boolean = false;
    versionNumber: string = '';
    description: string = '';
    layoutGroup: string = '';
    stringType: string = '';
    antialias: number = 1;
    pixelSize: number = 2;
    transparency: number = 0;
    blackTransparency: number = 0;
    lowDefinition: number = 100;  // Low definition render factor (1-100)
    advanced: boolean = false;  // Individual string start channels

    startChannel: string = '';
    controller: string = '';
    worldPosX: number = 0;
    worldPosY: number = 0;
    worldPosZ: number = 0;
    x2: number = 0;
    y2: number = 0;
    z2: number = 0;
    rotateX: number = 0;
    rotateY: number = 0;
    rotateZ: number = 0;
    scaleX: number = 1;
    scaleY: number = 1;
    scaleZ: number = 1;

    // Common model properties
    dir: string = 'L';
    startSide: string = 'B';
    modelBrightness: number = 0;
    strandNames: string = '';
    nodeNames: string = '';

    // Controller/pixel properties
    pixelCount: string = '';
    pixelType: string = '';
    pixelSpacing: string = '';

    // Color properties
    customColor: string = '';
    tagColour: string = '';  // Model tag color for UI display
    dimmingCurve?: NodeColorProfile;

    // Dynamic super string colours (SuperStringColour0, SuperStringColour1, etc.)
    // Used for single color multi-string models - makes each string behave as single color
    superStringColours: Map<number, string> = new Map();

    // Individual string start channels (String1, String2, etc.)
    // Used when Advanced="1" to specify per-string start channels
    stringStartChannels: Map<number, string> = new Map();

    // RGBW handling
    rgbwHandling: string = '';

    customBkgLightness: number = 1;
    customBkgImage: string = '';
    modelChain: string = '';
    shadowModelFor: string = '';

    // Legacy preview placement (pre-World coordinate system)
    offsetXpct: number = 0;
    offsetYpct: number = 0;
    previewScaleX: number = 0;
    previewScaleY: number = 0;
    previewRotation: number = 0;

    /**
     * Get channel-relevant information for this model.
     * Subclasses should override to provide accurate numStrings/nodesPerString.
     */
    getChannelInfo(): ModelChannelInfo {
        return {
            name: this.name,
            startChannel: this.startChannel || '1',
            stringType: this.stringType || 'RGB Nodes',
            numStrings: 1,
            nodesPerString: [this.getNumNodes()],
            advanced: this.advanced,
            stringStartChannels: this.stringStartChannels,
            superStringColourCount: this.superStringColours.size,
        };
    }
}

export function rotationMatrixFromXAxisToVector(a: vec3): mat4 {
    const v = vec3.fromValues(0, -a[2], a[1]); // Create the rotation axis
    const len = vec3.length(a);
    const ax = a[0] / len; // Normalize x-component
    const angle = Math.acos(ax); // Compute the angle

    if (ax > 0.9999 || angle === 0.0) {
        // Aligned with the x-axis, return identity matrix
        return mat4.create(); // Identity matrix
    } else if (ax < -0.9999 || Math.abs(angle - Math.PI) < 0.0001) {
        // Opposite x-axis direction
        const result = mat4.create();
        mat4.rotate(result, mat4.create(), Math.PI, [0.0, 1.0, 0.0]);
        return result;
    }

    // General case: Rotate by angle around vector v
    const result = mat4.create();
    mat4.rotate(result, mat4.create(), angle, v);
    return result;
}

export function rotationMatrixFromXAxisToVector2(o: vec3, p: vec3): mat4 {
    const a = vec3.create();
    vec3.subtract(a, p, o); // Compute vector a = p - o

    if (o[1] !== p[1] || o[2] !== p[2]) {
        const v = vec3.fromValues(0, -a[2], a[1]); // Create rotation axis
        const len = vec3.length(a);
        const angle = len === 0.0 ? 0.0 : Math.acos(a[0] / len); // Compute angle
        const result = mat4.create();
        mat4.rotate(result, mat4.create(), angle, v);
        return result;
    } else {
        if (p[0] < o[0]) {
            const result = mat4.create();
            mat4.rotate(result, mat4.create(), Math.PI, [0.0, 0.0, 1.0]);
            return result;
        } else {
            return mat4.create(); // Identity matrix
        }
    }
}

export function getWorldMatrixFor3Pt(mob: BaseModelClass, scaleX: number, shear: number = 0): mat4 {
    const origin = vec3.create();
    vec3.set(origin, mob.worldPosX, mob.worldPosY, mob.worldPosZ);

    let x = mob.x2;
    if (mob.x2 === 0.0 && mob.y2 === 0.0 && mob.z2 === 0.0) {
        x = 0.001;
    }

    const point2 = vec3.create();
    vec3.set(point2, x + mob.worldPosX, mob.y2 + mob.worldPosY, mob.z2 + mob.worldPosZ);

    let origin_calc = vec3.clone(origin);
    let point2_calc = vec3.clone(point2);
    let swapped = false;

    if (x < 0.0) {
        // Swap origin and point2 if x2 is negative
        origin_calc = vec3.clone(point2);
        point2_calc = vec3.clone(origin);
        swapped = true;
    }

    const a = vec3.create();
    vec3.subtract(a, point2_calc, origin_calc); // Calculate vector a = point2_calc - origin_calc

    const length = vec3.length(a);
    const scalex = length * scaleX; // We are taking over scaling / RenderWi;
    const scaley = scalex;
    const scalez = scalex;

    // Rotation matrix - aligns X axis to the line between endpoints
    const rotationMatrix = rotationMatrixFromXAxisToVector(a);

    // Scaling matrix
    const scalingMatrix = mat4.create();
    mat4.scale(scalingMatrix, mat4.create(), [scalex, scaley, scalez]);

    // Shear matrix - shears Y based on X position
    const shearMatrix = mat4.create();
    if (shear !== 0) {
        // gl-matrix doesn't have a shear function, so set it manually
        // Shear Y by X: element [1][0] = shear value
        shearMatrix[4] = shear; // mat4 is column-major: [1][0] is index 4
    }

    // Rotation matrices
    const RotateY = mat4.create();
    mat4.rotateY(RotateY, mat4.create(), Math.PI);

    // RotateX rotates around the model's local X axis (the line between endpoints)
    // This changes the "drop direction" for icicles
    const RotateX = mat4.create();
    mat4.rotateX(RotateX, mat4.create(), (mob.rotateX * Math.PI) / 180);

    // Translation matrix
    const translateMatrix = mat4.create();
    mat4.translate(translateMatrix, mat4.create(), [mob.worldPosX, mob.worldPosY, mob.worldPosZ]);

    // Adjust rotation matrix if swapped
    if (swapped) {
        mat4.multiply(rotationMatrix, rotationMatrix, RotateY);
    }

    // Final transformation matrix
    // Order: Translate * RotationToEndpoints * RotateX * Shear * Scale
    // This matches C++: matrix = TranslateMatrix * rotationMatrix * RotateX * shearMatrix * scalingMatrix
    const matrix = mat4.create();
    mat4.multiply(matrix, translateMatrix, rotationMatrix);
    mat4.multiply(matrix, matrix, RotateX);
    mat4.multiply(matrix, matrix, shearMatrix);
    mat4.multiply(matrix, matrix, scalingMatrix);
    return matrix;
}

export function getWorldMatrixFor2Pt(mob: BaseModelClass, scaleX: number, shear: number = 0): mat4 {
    const matrix = mat4.create();
    const origin = vec3.create();
    vec3.set(origin, mob.worldPosX, mob.worldPosY, mob.worldPosZ);
    let x = mob.x2;
    if (mob.x2 === 0.0 && mob.y2 === 0.0 && mob.z2 === 0.0) {
        x = 0.001;
    }
    const point2 = vec3.create();
    vec3.set(point2, x + mob.worldPosX, mob.y2 + mob.worldPosY, mob.z2 + mob.worldPosZ);

    const a = vec3.create();
    vec3.subtract(a, point2, origin);
    const length = vec3.length(a);
    const scale = length * scaleX;

    const scalingMatrix = mat4.create();
    mat4.scale(scalingMatrix, mat4.create(), [scale, scale, scale]);

    const rotationMatrix = rotationMatrixFromXAxisToVector2(origin, point2);

    // Shear matrix - shears Y based on X position
    // This makes drops lean to one side
    // Matrix form: y' = y + shear * x
    const shearMatrix = mat4.create();
    if (shear !== 0) {
        // gl-matrix doesn't have a shear function, so set it manually
        // Shear Y by X: element [1][0] = shear value
        shearMatrix[4] = shear; // mat4 is column-major: [1][0] is index 4
    }

    const translateMatrix = mat4.create();
    mat4.translate(translateMatrix, mat4.create(), [mob.worldPosX, mob.worldPosY, mob.worldPosZ]);

    mat4.multiply(matrix, translateMatrix, rotationMatrix);
    mat4.multiply(matrix, matrix, shearMatrix);
    mat4.multiply(matrix, matrix, scalingMatrix);
    return matrix;
}

/**
 * World matrix for BoxedScreenLocation models (custom, cube, matrix with depth, etc.)
 * Uses WorldPos for position, Scale for size, and Rotate for orientation.
 * Model coordinates are expected to be in the range [-width/2, width/2] etc.
 * The scale factors (ScaleX/Y/Z) are applied directly to these coordinates.
 *
 * @param mob The model
 * @param perspective2D Optional perspective angle in radians for 2D view (default 0).
 *   When non-zero, applies an X-axis rotation after the model rotation but before translation.
 *   This tilts 3D models so back nodes are visible in 2D view.
 *   Common values: 0.1 for custom/cube/sphere, 0.2 for trees.
 */
export function getWorldMatrixForBoxed(mob: BaseModelClass, perspective2D: number = 0): mat4 {
    const matrix = mat4.create();

    // Scale factors from model - applied directly to model coordinates
    // Model coordinates already span [-RenderWi/2, RenderWi/2], etc.
    const sx = mob.scaleX;
    const sy = mob.scaleY;
    const sz = mob.scaleZ;

    // Build transformation matching xLights BoxedScreenLocation::TranslatePoint:
    //   1. Scale by scalex/y/z
    //   2. Rotate by quaternion (built from rz * ry * rx)
    //   3. If 2D mode with perspective: rotate around X by perspective radians
    //   4. Translate by worldPos
    // Scaling matrix
    const scalingMatrix = mat4.create();
    mat4.scale(scalingMatrix, mat4.create(), [sx, sy, sz]);

    // Rotation matrices (convert degrees to radians)
    const rotXMatrix = mat4.create();
    mat4.rotateX(rotXMatrix, mat4.create(), (mob.rotateX * Math.PI) / 180);

    const rotYMatrix = mat4.create();
    mat4.rotateY(rotYMatrix, mat4.create(), (mob.rotateY * Math.PI) / 180);

    const rotZMatrix = mat4.create();
    mat4.rotateZ(rotZMatrix, mat4.create(), (mob.rotateZ * Math.PI) / 180);

    // 2D perspective matrix - rotates around X axis to tilt model for 2D viewing
    const perspectiveMatrix = mat4.create();
    if (perspective2D !== 0) {
        mat4.rotateX(perspectiveMatrix, mat4.create(), perspective2D);
    }

    // Translation matrix
    const translateMatrix = mat4.create();
    mat4.translate(translateMatrix, mat4.create(), [mob.worldPosX, mob.worldPosY, mob.worldPosZ]);

    // Combine: T * Perspective * Rz * Ry * Rx * S
    // (perspective applied after model rotation, before translation)
    mat4.multiply(matrix, translateMatrix, perspectiveMatrix);
    mat4.multiply(matrix, matrix, rotZMatrix);
    mat4.multiply(matrix, matrix, rotYMatrix);
    mat4.multiply(matrix, matrix, rotXMatrix);
    mat4.multiply(matrix, matrix, scalingMatrix);

    return matrix;
}

export function defNodeLoc(): NodeLoc {
    return {
        physicalNum: -1,
        physicalStrand: -1,
        physicalNumOnStrand: -1,

        logicalNum: -1,
        logicalX: -1,
        logicalY: -1,
        logicalZ: -1,

        coords: [],
    };
}

export function defNodeCoord(): NodeCoord {
    return {
        bufX: 0,
        bufY: 0,
        bufZ: 0,

        modelX: 0,
        modelY: 0,
        modelZ: 0,

        wX: 0,
        wY: 0,
        wZ: 0,
    };
}

export function defEffectBufferDescriptionOutput(): EffectBufferDescriptionOutput {
    return {
        dense: false,
        width: 1,
        height: 1,
        direction: "H",
        zigzag: false,
        alternate: false,
        startLeft: true,
        startUpper: true,
        startInner: true,
    };
}

