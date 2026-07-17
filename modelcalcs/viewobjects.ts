import {
    getAttrDef,
    getBoolAttrDef,
    getChildElementsByTag,
    getNumAttrDef,
    getOptionalElementByTag,
} from './utils';

/**
 * A single entry from the `<view_objects>` section of `xlights_rgbeffects.xml`.
 *
 * xLights stores non-pixel layout scenery here: `Mesh` (3D .obj files),
 * `Image` (billboard images), `Terrain`, `Gridlines`, `Ruler`, ...
 * ALL entries are returned regardless of DisplayAs — callers filter for the
 * kinds they care about (e.g. Mesh/Image for preview rendering).
 *
 * File paths (`objFile`, `imageFile`) are returned exactly as stored in the
 * XML — resolving them against the show folder is the caller's job.
 */
export interface ViewObjectInfo {
    /** Object name (unique within the layout). */
    name: string;
    /**
     * Object kind: "Mesh", "Image", "Terrain", "Gridlines", "Ruler", ...
     * The legacy misspelling "Terrian" (written by pre-x2026_3 xLights) is
     * normalized to "Terrain", matching the forward migration.
     */
    displayAs: string;
    /** xLights `Active` flag; defaults to true when absent. */
    active: boolean;
    /** Mesh objects: the `ObjFile` attribute (raw path, caller resolves). */
    objFile?: string;
    /** Image objects: the `Image` attribute (raw path, caller resolves). */
    imageFile?: string;

    worldPosX: number;
    worldPosY: number;
    worldPosZ: number;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
    /** Rotation in degrees around each axis, matching xLights convention. */
    rotateX: number;
    rotateY: number;
    rotateZ: number;

    /** Render brightness, 0–100 (default 100). */
    brightness: number;
    /** Render transparency, 0–100 (default 0). */
    transparency: number;
}

/** getNumAttrDef passes NaN through for malformed numeric attributes; view
 *  objects come from hand-editable XML, so coerce NaN to the default here. */
function numAttr(el: Element, nm: string, def: number): number {
    const v = getNumAttrDef(el, nm, def);
    return Number.isNaN(v) ? def : v;
}

/**
 * Parse the `<view_objects>` section of an xLights `xlights_rgbeffects.xml`.
 *
 * Accepts BOTH the x2026_2 and x2026_3 rgbeffects formats without
 * pre-migration — the section is format-identical apart from the
 * "Terrian" → "Terrain" DisplayAs spelling fix, which is normalized here.
 *
 * Returns one `ViewObjectInfo` per `<view_object>` child, in document order.
 * Entries without a usable `name` attribute are skipped. Returns `[]` when
 * the `<view_objects>` element is absent.
 */
export function getAllViewObjects(rgbeffectsDoc: Document): ViewObjectInfo[] {
    const root = rgbeffectsDoc.documentElement;
    if (!root) return [];

    const container = getOptionalElementByTag(root, 'view_objects');
    if (!container) return [];

    const objects: ViewObjectInfo[] = [];
    for (const el of getChildElementsByTag(container, 'view_object')) {
        const name = getAttrDef(el, 'name', '').trim();
        if (!name) continue;

        let displayAs = getAttrDef(el, 'DisplayAs', '');
        if (displayAs === 'Terrian') displayAs = 'Terrain'; // legacy spelling → forward-migrated form

        const objFile = getAttrDef(el, 'ObjFile', '');
        const imageFile = getAttrDef(el, 'Image', '');

        objects.push({
            name,
            displayAs,
            active: getBoolAttrDef(el, 'Active', true),
            objFile: objFile || undefined,
            imageFile: imageFile || undefined,
            worldPosX: numAttr(el, 'WorldPosX', 0),
            worldPosY: numAttr(el, 'WorldPosY', 0),
            worldPosZ: numAttr(el, 'WorldPosZ', 0),
            scaleX: numAttr(el, 'ScaleX', 1),
            scaleY: numAttr(el, 'ScaleY', 1),
            scaleZ: numAttr(el, 'ScaleZ', 1),
            rotateX: numAttr(el, 'RotateX', 0),
            rotateY: numAttr(el, 'RotateY', 0),
            rotateZ: numAttr(el, 'RotateZ', 0),
            brightness: numAttr(el, 'Brightness', 100),
            transparency: numAttr(el, 'Transparency', 0),
        });
    }

    return objects;
}
