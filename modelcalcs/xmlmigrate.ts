/**
 * XML migration between xLights layout format versions.
 *
 * Three format versions are recognized:
 *   'x2026_2'  — the format used by xLights through 2026.2 (and derived forks)
 *   'x2026_3'  — the format introduced in xLights 2026.3+
 *   'x2026_15' — x2026_3 schema plus view-object types (Controller) that
 *                earlier versions cannot load
 *
 * Handles migration in either direction for xlights_rgbeffects.xml.  Every
 * migration also removes <view_object>s the target cannot load
 * (VIEW_OBJECT_ALLOW_LIST).
 * xlights_networks.xml schema is identical across versions — no migration needed.
 *
 * Usage with @xmldom/xmldom:
 *   const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
 *   const doc = new DOMParser().parseFromString(xmlString, 'text/xml');
 *
 *   // Detect what you have:
 *   const info = identifyXml(doc);
 *   // => { fileType: 'rgbeffects', format: 'x2026_2' }
 *
 *   // Convert to a target format regardless of current state:
 *   const result = migrateToFormat(doc, 'x2026_3');
 *   const xml = new XMLSerializer().serializeToString(result.doc);
 *   // result.effectPresetsJson is set when migrating to x2026_3 (string or undefined)
 */

import {
    XMLConstants,
    getChildElementsByTag,
    getOptionalElementByTag,
} from './utils';

// ---------------------------------------------------------------------------
// parm1/2/3 → named attribute mapping per DisplayAs type
// ---------------------------------------------------------------------------

export interface ParmMapping {
    parm1?: string;
    parm2?: string;
    parm3?: string;
}

/**
 * Maps DisplayAs values to their upstream named attribute equivalents.
 * If a model type is not listed, its parm attributes are left as-is.
 */
// Note on Tree/Sphere: only the base "Tree" and "Sphere" entries are listed here.
// The fork's DisplayAs values include variants like "Tree 360", "Tree 220", "Sphere 270",
// etc. with arbitrary degree values, plus "Tree Flat" and "Tree Ribbon".
// findParmMapping() resolves all of these programmatically by checking
// startsWith('Tree ') / startsWith('Sphere ') — do NOT enumerate variants here.
export const PARM_RENAMES: Record<string, ParmMapping> = {
    'Arches':        { parm1: 'NumArches',    parm2: 'NodesPerArch',    parm3: 'LightsPerNode' },
    'Candy Canes':   { parm1: 'NumCanes',     parm2: 'NodesPerCane',    parm3: 'LightsPerNode' },
    'Channel Block': { parm1: 'NumChannels' },
    'Circle':        { parm1: 'NumStrings',   parm2: 'NodesPerString',  parm3: 'centerPercent' },
    'Cube':          { parm1: 'CubeWidth',    parm2: 'CubeHeight',      parm3: 'CubeDepth' },
    'Custom':        { parm1: 'CustomWidth',  parm2: 'CustomHeight' },
    'Icicles':       { parm1: 'NumStrings',   parm2: 'NodesPerString' },
    'Horiz Matrix':  { parm1: 'NumStrings',   parm2: 'NodesPerString',  parm3: 'StrandsPerString' },
    'Vert Matrix':   { parm1: 'NumStrings',   parm2: 'NodesPerString',  parm3: 'StrandsPerString' },
    'Matrix':        { parm1: 'NumStrings',   parm2: 'NodesPerString',  parm3: 'StrandsPerString' },
    'Single Line':   { parm1: 'NumStrings',   parm2: 'NodesPerString',  parm3: 'LightsPerNode' },
    // Poly Line: upstream restructured some semantics (NodesPerString value may differ
    // from old parm2), but the attribute names still need renaming so the old code
    // doesn't see zero for parm2/parm3. parm1 is not renamed — old code uses it as-is
    // and the upstream writes NumPoints separately in the screen location system.
    'Poly Line':     { parm2: 'NodesPerString',  parm3: 'LightsPerNode' },
    // Sphere is implemented as a Matrix variant internally — parm3 is StrandsPerString,
    // NOT LightsPerNode.  Verified against upstream BaseSerializingVisitor::Visit(SphereModel).
    'Sphere':        { parm1: 'NumStrings',   parm2: 'NodesPerString',  parm3: 'StrandsPerString' },
    'Spinner':       { parm1: 'NumStrings',   parm2: 'NodesPerArm',     parm3: 'ArmsPerString' },
    'Star':          { parm1: 'NumStrings',   parm2: 'NodesPerString',  parm3: 'StarPoints' },
    'Tree':          { parm1: 'NumStrings',   parm2: 'NodesPerString',  parm3: 'StrandsPerString' },
    'Wreath':        { parm1: 'NumStrings',   parm2: 'NodesPerString' },
    // Image: upstream doesn't use parm1/parm2/parm3 at all (Visit/Deserialize only
    // touch ImageFile, WhiteAsAlpha, OffBrightness).  Image always has 1 node so
    // the fork's parm1/parm2/parm3 are vestigial — no rename needed in either direction.
    'Window Frame':  { parm1: 'TopNodes',     parm2: 'SideNodes',       parm3: 'BottomNodes' },
    // DMX models: upstream renamed parm1 to DmxChannelCount (see
    // BaseSerializingVisitor::AddDmxModelAttributes).  parm2/parm3 are hardcoded
    // to 1 in the fork's DmxModel/DmxGeneral/DmxMovingHead InitModel and carry
    // no semantic data — no rename needed for those.  All other DMX attributes
    // (motor child elements, color/beam/shutter/dimmer/preset/fixture) already
    // share identical names between fork and upstream.
    // findParmMapping() resolves all concrete DMX DisplayAs values (DmxFloodArea,
    // DmxFloodlight, DmxGeneral, DmxMovingHead, DmxMovingHeadAdv, DmxServo,
    // DmxServo3d, DmxSkull, and the uppercase 'DMX' fallback) to this base entry
    // via a startsWith check — do NOT enumerate each subtype here.
    // DmxSkulltronix is fork-only (upstream removed the model), but it still
    // benefits from the rename for round-trip preservation through upstream.
    'Dmx':           { parm1: 'DmxChannelCount' },
};

// ---------------------------------------------------------------------------
// Per-model-type attribute renames (non-parm).  Upstream changed the case or
// name of these attributes while old xLights still reads the legacy form.
// Keyed by DisplayAs.  Map is { legacyName: upstreamName }.
//
// Forward migration (x2026_2 → x2026_3): legacyName → upstreamName.
// Backward migration (x2026_3 → x2026_2): upstreamName → legacyName.
//
// Note: Star/Circle use LayerSizes in BOTH formats — no rename needed.
// The upstream has legacy fallbacks for starSizes/circleSizes but those
// predate the x2026_2 fork format and are not used in round-trip.
// ---------------------------------------------------------------------------

export const MODEL_ATTR_RENAMES: Record<string, Record<string, string>> = {
    'Arches': { 'arc': 'Arc' },
};

// ---------------------------------------------------------------------------
// ControllerConnection child element attribute renames.  Upstream renamed
// these to capitalized/PascalCase form while the old format used camelCase.
// These live on <ControllerConnection> child elements of <model>.
// ---------------------------------------------------------------------------

export const CONTROLLER_CONNECTION_RENAMES: Record<string, string> = {
    // legacy → upstream
    'brightness': 'Brightness',
    'reverse':    'Reverse',
    'zigZag':     'ZigZag',
};

// ---------------------------------------------------------------------------
// Default attribute values the upstream (x2026_3) always writes but the
// old format (x2026_2) omits.  Extracted from modeldev vs modeldevnew
// test data comparison.  Only includes values that are consistent across
// all models of that type (not per-instance data).
//
// Keyed by the UPSTREAM DisplayAs value (post-normalization).
// ---------------------------------------------------------------------------

export const UPSTREAM_DEFAULTS: Record<string, Record<string, string>> = {
    'Arches': {
        'Hollow': '70',
        'Shear': '0.000000',
    },
    'Candy Canes': {
        'CandyCaneHeight': '1.000000',
        'CandyCaneReverse': 'false',
        'CandyCaneSticks': 'false',
        'Shear': '0.000000',
    },
    'Cube': {
        'CubeHollow': '0',
        'CubeRowOffset': '0',
        'CubeShape': '0',
        'Start': 'Front Bottom Left',
        'StrandPerLayer': 'FALSE',
        'StrandPerLine': 'Zig Zag',
        'Strings': '1',
    },
    'Icicles': {
        'Angle': '0',
    },
    'Matrix': {
        'LowDefinition': '100',
    },
    'Poly Line': {
        'DropPattern': '1',
        'ModelHeight': '1.000000',
        'PolyStrings': '1',
        'SegsExpanded': 'TRUE',
    },
    'Sphere': {
        'Degrees': '360',
        'EndLatitude': '86',
        'LowDefinition': '100',
        'StartLatitude': '-86',
    },
    'Spinner': {
        'Alternate': 'false',
        'StartAngle': '0',
        'ZigZag': 'false',
    },
    'Star': {
        'starRatio': '2.618034',
    },
    'Tree': {
        'StrandDir': 'Vertical',
        'TreeBottomTopRatio': '6.000000',
        'TreePerspective': '0.200000',
        'TreeRotation': '3.000000',
        'TreeSpiralRotations': '0.000000',
    },
    'Window Frame': {
        'Rotation': 'Clockwise',
    },
};

/**
 * Build a reverse lookup: upstream named attribute → which parm it came from.
 * Used during backward migration to find the right parm slot.
 */
function buildReverseParmLookup(mapping: ParmMapping): Record<string, string> {
    const rev: Record<string, string> = {};
    if (mapping.parm1) rev[mapping.parm1] = 'parm1';
    if (mapping.parm2) rev[mapping.parm2] = 'parm2';
    if (mapping.parm3) rev[mapping.parm3] = 'parm3';
    return rev;
}

// ---------------------------------------------------------------------------
// Format detection and validation
// ---------------------------------------------------------------------------

/** The XML file types we recognize. */
export type XlFileType = 'rgbeffects' | 'networks' | 'unknown';

/**
 * The schema variant for rgbeffects files.  'x2026_15' is reported only when
 * a 2026.15-only view object is present; otherwise the file reads as 'x2026_3'.
 */
export type XlFormat = 'x2026_2' | 'x2026_3' | 'x2026_15' | 'indeterminate';

export interface XlFileIdentification {
    /** What kind of xLights XML file this is. */
    fileType: XlFileType;
    /**
     * For rgbeffects: 'x2026_2', 'x2026_3' or 'x2026_15' based on structural signals.
     * For networks: always 'indeterminate' (schema is identical).
     * For unknown: always 'indeterminate'.
     */
    format: XlFormat;
    /** Signals that pointed toward x2026_3 (or later) format. */
    x2026_3_signals: string[];
    /** Signals that pointed toward x2026_2 format. */
    x2026_2_signals: string[];
}

// ---------------------------------------------------------------------------
// View-object support by target version
// ---------------------------------------------------------------------------

/**
 * <view_object DisplayAs="..."> values each target version can load; anything
 * else is removed on migration, since an unknown type crashes xLights at load.
 * 'Terrain' stays allowed for x2026_2 because the fork reads both spellings.
 */
export const VIEW_OBJECT_ALLOW_LIST: Readonly<Record<TargetFormat, readonly string[]>> = {
    x2026_2:  ['Gridlines', 'Image', 'Mesh', 'Ruler', 'Terrian', 'Terrain'],
    x2026_3:  ['Gridlines', 'Image', 'Mesh', 'Ruler', 'Terrian', 'Terrain'],
    x2026_15: ['Gridlines', 'Image', 'Mesh', 'Ruler', 'Terrian', 'Terrain', 'Controller'],
};

/** View-object DisplayAs values that only exist from 2026.15 on. */
const X2026_15_ONLY_VIEW_OBJECTS: ReadonlySet<string> = new Set(
    VIEW_OBJECT_ALLOW_LIST.x2026_15.filter(t => !VIEW_OBJECT_ALLOW_LIST.x2026_3.includes(t)));

/**
 * Delete every <view_object> whose DisplayAs is not on the allow list for the
 * target format.  Idempotent.  Appends one entry per removed object to
 * `changes` (if given) and returns the number removed.
 */
export function filterViewObjectsForFormat(doc: Document, target: TargetFormat, changes?: string[]): number {
    const root = doc.documentElement;
    if (!root) return 0;
    const viewObjNode = getOptionalElementByTag(root, 'view_objects');
    if (!viewObjNode) return 0;
    const allowed = VIEW_OBJECT_ALLOW_LIST[target];
    let removed = 0;
    for (const obj of getChildElementsByTag(viewObjNode, 'view_object')) {
        const da = obj.getAttribute('DisplayAs') || '';
        if (allowed.includes(da)) continue;
        viewObjNode.removeChild(obj);
        removed++;
        changes?.push(`Removed view_object "${obj.getAttribute('name') || ''}" (DisplayAs="${da}" not supported by ${target})`);
    }
    return removed;
}

/**
 * Quick check: is this a valid xLights XML file at all?
 * Suitable for browser-side validation before upload.
 *
 * @param doc  Parsed XML Document
 * @returns    The file type, or 'unknown' if not recognized
 */
export function identifyFileType(doc: Document): XlFileType {
    const root = doc.documentElement;
    if (!root) return 'unknown';
    if (root.tagName === 'xrgb') return 'rgbeffects';
    if (root.tagName === 'Networks') return 'networks';
    return 'unknown';
}

/**
 * Identify both file type and format variant.
 *
 * For rgbeffects files, inspects high-level DOM nodes to determine whether
 * the document is in x2026_2 or x2026_3 format.  The check is heuristic —
 * a document that has been partially migrated scores both signals and
 * the majority wins; a tie returns 'indeterminate'.
 *
 * For networks files the schema is identical, so format is always 'indeterminate'.
 */
export function identifyXml(doc: Document): XlFileIdentification {
    const fileType = identifyFileType(doc);
    if (fileType !== 'rgbeffects') {
        return { fileType, format: 'indeterminate', x2026_3_signals: [], x2026_2_signals: [] };
    }

    const root = doc.documentElement!;
    const newSignals: string[] = [];  // x2026_3
    const oldSignals: string[] = [];  // x2026_2

    // Signal 1: <models type="rgb_effects">
    const modelsNode = getOptionalElementByTag(root, 'models');
    if (modelsNode) {
        if (modelsNode.getAttribute('type') === 'rgb_effects') {
            newSignals.push('<models type="rgb_effects">');
        } else {
            oldSignals.push('<models> without type attr');
        }
    }

    // Signal 2: <effects> node present with version attr → x2026_2; absent → x2026_3
    const effectsNode = getOptionalElementByTag(root, 'effects');
    if (effectsNode && effectsNode.getAttribute('version')) {
        oldSignals.push('<effects version="..."> present in XML');
    } else if (!effectsNode) {
        newSignals.push('<effects> node absent (presets in JSON)');
    }

    // Signal 3: <perspectives current="...">
    const perspNode = getOptionalElementByTag(root, 'perspectives');
    if (perspNode) {
        if (perspNode.hasAttribute('current')) {
            newSignals.push('<perspectives current="...">');
        } else {
            oldSignals.push('<perspectives> without current attr');
        }
    }

    // Signal 4: <perspective version="2.0">
    if (perspNode) {
        const firstPersp = getOptionalElementByTag(perspNode, 'perspective');
        if (firstPersp) {
            if (firstPersp.hasAttribute('version')) {
                newSignals.push('<perspective version="...">');
            } else {
                oldSignals.push('<perspective> without version attr');
            }
        }
    }

    // Signal 5: <modelGroups type="rgb_effects">
    const groupsNode = getOptionalElementByTag(root, 'modelGroups');
    if (groupsNode) {
        if (groupsNode.getAttribute('type') === 'rgb_effects') {
            newSignals.push('<modelGroups type="rgb_effects">');
        } else {
            oldSignals.push('<modelGroups> without type attr');
        }
    }

    // Signal 6: model attribute naming — sample first model with a DisplayAs we know
    if (modelsNode) {
        const models = getChildElementsByTag(modelsNode, 'model');
        for (const model of models) {
            const da = model.getAttribute('DisplayAs') || '';
            const mapping = findParmMapping(da);
            if (!mapping) continue;
            if (model.hasAttribute('parm1')) {
                oldSignals.push(`model uses parm1 (${da})`);
            } else if (mapping.parm1 && model.hasAttribute(mapping.parm1)) {
                newSignals.push(`model uses ${mapping.parm1} (${da})`);
            }
            break; // one sample is enough
        }
    }

    // Signal 7: Tree/Sphere/Matrix DisplayAs encoding
    if (modelsNode) {
        const models = getChildElementsByTag(modelsNode, 'model');
        for (const model of models) {
            const da = model.getAttribute('DisplayAs') || '';
            if (da.startsWith('Tree ') || da.startsWith('Sphere ')
                || da === 'Horiz Matrix' || da === 'Vert Matrix') {
                oldSignals.push(`combined DisplayAs="${da}"`);
                break;
            }
            if (da === 'Tree' && model.hasAttribute('TreeDegrees')) {
                newSignals.push('split DisplayAs="Tree" + TreeDegrees');
                break;
            }
            if (da === 'Matrix' && model.hasAttribute('Vertical')) {
                newSignals.push('split DisplayAs="Matrix" + Vertical');
                break;
            }
        }
    }

    // Signal 8: 2026.15-only view-object types; refines an x2026_3 verdict to x2026_15
    let has2026_15ViewObjects = false;
    const viewObjNode = getOptionalElementByTag(root, 'view_objects');
    if (viewObjNode) {
        for (const obj of getChildElementsByTag(viewObjNode, 'view_object')) {
            const da = obj.getAttribute('DisplayAs') || '';
            if (X2026_15_ONLY_VIEW_OBJECTS.has(da)) {
                newSignals.push(`<view_object DisplayAs="${da}"> (2026.15+)`);
                has2026_15ViewObjects = true;
                break;
            }
        }
    }

    let format: XlFormat;
    if (newSignals.length > oldSignals.length) {
        format = has2026_15ViewObjects ? 'x2026_15' : 'x2026_3';
    } else if (oldSignals.length > newSignals.length) {
        format = 'x2026_2';
    } else {
        format = 'indeterminate';
    }

    return { fileType, format, x2026_3_signals: newSignals, x2026_2_signals: oldSignals };
}

// ---------------------------------------------------------------------------
// Effect presets: XML ↔ JSON conversion
// ---------------------------------------------------------------------------

export interface EffectPreset {
    type: 'effect';
    name: string;
    settings: string;
    version: string;
    xLightsVersion: string;
}

export interface EffectPresetGroup {
    type: 'group';
    name: string;
    children: EffectPresetItem[];
}

export type EffectPresetItem = EffectPreset | EffectPresetGroup;

export interface EffectPresetsJson {
    version: string;
    children: EffectPresetItem[];
}

/** Convert an <effects> XML subtree to the JSON structure. */
function effectsXmlToJson(effectsNode: Element): EffectPresetsJson {
    const version = effectsNode.getAttribute('version') || '0007';
    const children = convertEffectChildren(effectsNode);
    return { version, children };
}

function convertEffectChildren(parent: Element): EffectPresetItem[] {
    const items: EffectPresetItem[] = [];
    for (let i = 0; i < parent.childNodes.length; i++) {
        const node = parent.childNodes[i];
        if (node.nodeType !== XMLConstants.ELEMENT_NODE) continue;
        const el = node as Element;
        if (el.tagName === 'effect') {
            const settings = el.getAttribute('settings') || '';
            // Only import presets whose settings contain a tab (upstream validation rule)
            if (settings.includes('\t')) {
                items.push({
                    type: 'effect',
                    name: el.getAttribute('name') || '',
                    settings,
                    version: el.getAttribute('version') || '0007',
                    xLightsVersion: el.getAttribute('xLightsVersion') || '4.0',
                });
            }
        } else if (el.tagName === 'effectGroup') {
            items.push({
                type: 'group',
                name: el.getAttribute('name') || '',
                children: convertEffectChildren(el),
            });
        }
    }
    return items;
}

/** Convert the JSON structure back to XML nodes under a new <effects> element. */
function effectsJsonToXml(doc: Document, json: EffectPresetsJson): Element {
    const effectsEl = doc.createElement('effects');
    effectsEl.setAttribute('version', json.version || '0007');
    appendEffectChildren(doc, effectsEl, json.children);
    return effectsEl;
}

function appendEffectChildren(doc: Document, parent: Element, items: EffectPresetItem[]): void {
    for (const item of items) {
        if (item.type === 'effect') {
            const el = doc.createElement('effect');
            el.setAttribute('name', item.name);
            el.setAttribute('settings', item.settings);
            el.setAttribute('version', item.version);
            el.setAttribute('xLightsVersion', item.xLightsVersion);
            parent.appendChild(el);
        } else {
            const el = doc.createElement('effectGroup');
            el.setAttribute('name', item.name);
            appendEffectChildren(doc, el, item.children);
            parent.appendChild(el);
        }
    }
}

// ---------------------------------------------------------------------------
// Core migration
// ---------------------------------------------------------------------------

export type MigrationDirection = 'forward' | 'backward';
/** Migration targets.  'x2026_3' and 'x2026_15' share a model schema and differ only in allowed view objects. */
export type TargetFormat = 'x2026_2' | 'x2026_3' | 'x2026_15';

export interface MigrationResult {
    /** The mutated document (same reference that was passed in). */
    doc: Document;
    /** What format the document was in before migration. */
    detectedFormat: XlFormat;
    /**
     * When migrating to x2026_3/x2026_15: JSON string for xlights_effectpresets.json
     * (undefined if no effects node was found or already in the upstream schema).
     * When migrating to x2026_2: undefined.
     */
    effectPresetsJson?: string;
    /** Human-readable log of changes applied. Empty if already in target format. */
    changes: string[];
}

/** The model-schema family a format belongs to; undefined for 'indeterminate'. */
function schemaFamily(f: XlFormat | TargetFormat): 'legacy' | 'upstream' | undefined {
    switch (f) {
        case 'x2026_2': return 'legacy';
        case 'x2026_3':
        case 'x2026_15': return 'upstream';
        default: return undefined;
    }
}

/**
 * Idempotent migration: detect current format, then convert to the target.
 * If the document is already in the target format, returns with an empty changes list.
 * The schema transform runs only when crossing the x2026_2 ↔ x2026_3 family
 * boundary; view objects the target cannot load are always pruned.
 *
 * @param doc        Parsed XML Document (from @xmldom/xmldom DOMParser)
 * @param target     'x2026_2', 'x2026_3' or 'x2026_15'
 * @param effectPresetsJsonStr  When targeting x2026_2: optional JSON string
 *                              from xlights_effectpresets.json to embed into XML.
 */
export function migrateToFormat(
    doc: Document,
    target: TargetFormat,
    effectPresetsJsonStr?: string,
): MigrationResult {
    const id = identifyXml(doc);
    if (id.fileType !== 'rgbeffects') {
        throw new Error(`Not an rgbeffects file (root element: <${doc.documentElement?.tagName || '?'}>)`);
    }

    const changes: string[] = [];
    let effectPresetsJson: string | undefined;

    // Schema transform only when crossing families (indeterminate always runs; the transforms are idempotent)
    if (schemaFamily(id.format) !== schemaFamily(target)) {
        if (target === 'x2026_2') {
            const result = migrateBackward(doc, effectPresetsJsonStr);
            changes.push(...result.changes);
        } else {
            const result = migrateForward(doc);
            changes.push(...result.changes);
            effectPresetsJson = result.effectPresetsJson;
        }
    }

    filterViewObjectsForFormat(doc, target, changes);

    return { doc, detectedFormat: id.format, effectPresetsJson, changes };
}

/**
 * Directional migration — use when you know which way to go.
 *
 * @param doc        Parsed XML Document (from @xmldom/xmldom DOMParser)
 * @param direction  'forward' = x2026_2→x2026_3, 'backward' = x2026_3→x2026_2
 *                   (both also prune view objects the resulting version cannot load)
 * @param effectPresetsJsonStr  For backward migration: the contents of
 *                              xlights_effectpresets.json to embed back into XML.
 *                              Ignored for forward migration.
 */
export function migrateRgbEffects(
    doc: Document,
    direction: MigrationDirection,
    effectPresetsJsonStr?: string,
): MigrationResult {
    const id = identifyXml(doc);
    if (direction === 'forward') {
        const result = migrateForward(doc);
        filterViewObjectsForFormat(doc, 'x2026_3', result.changes);
        return { ...result, detectedFormat: id.format };
    } else {
        const result = migrateBackward(doc, effectPresetsJsonStr);
        filterViewObjectsForFormat(doc, 'x2026_2', result.changes);
        return { ...result, detectedFormat: id.format };
    }
}

// ---------------------------------------------------------------------------
// Forward migration  (x2026_2 → x2026_3)
// ---------------------------------------------------------------------------

type InternalResult = Omit<MigrationResult, 'detectedFormat'>;

function migrateForward(doc: Document): InternalResult {
    const changes: string[] = [];
    const root = doc.documentElement;
    if (!root) throw new Error('Document has no root element');

    // 1. <models> → <models type="rgb_effects">
    const modelsNode = getOptionalElementByTag(root, 'models');
    if (modelsNode && !modelsNode.getAttribute('type')) {
        modelsNode.setAttribute('type', 'rgb_effects');
        changes.push('Added type="rgb_effects" to <models>');
    }

    // 2. Per-model forward transform (parm renames, DisplayAs splits, attr
    //    renames, ControllerConnection renames, legacy-default
    //    materialization) — shared with normalizeModelElementForward.
    if (modelsNode) {
        const models = getChildElementsByTag(modelsNode, 'model');
        for (const model of models) {
            forwardMigrateModelElement(model, changes);
        }
    }

    // 3. <modelGroups> → <modelGroups type="rgb_effects">
    const groupsNode = getOptionalElementByTag(root, 'modelGroups');
    if (groupsNode && !groupsNode.getAttribute('type')) {
        groupsNode.setAttribute('type', 'rgb_effects');
        changes.push('Added type="rgb_effects" to <modelGroups>');
    }

    // 4. Extract <effects> to JSON and remove from XML
    let effectPresetsJson: string | undefined;
    const effectsNode = getOptionalElementByTag(root, 'effects');
    if (effectsNode) {
        // Check if it has any content worth extracting
        const hasChildren = effectsNode.childNodes.length > 0;
        const hasVersion = effectsNode.getAttribute('version');
        if (hasChildren || hasVersion) {
            const json = effectsXmlToJson(effectsNode);
            effectPresetsJson = JSON.stringify(json, null, 2);
            changes.push(`Extracted ${countPresets(json.children)} effect presets to JSON`);
        }
        root.removeChild(effectsNode);
        changes.push('Removed <effects> node from XML');
    }

    // 5. <perspectives> → add current="..."
    const perspNode = getOptionalElementByTag(root, 'perspectives');
    if (perspNode && !perspNode.getAttribute('current')) {
        const firstPersp = getOptionalElementByTag(perspNode, 'perspective');
        const currentName = firstPersp ? (firstPersp.getAttribute('name') || '') : '';
        perspNode.setAttribute('current', currentName);
        changes.push(`Added current="${currentName}" to <perspectives>`);
    }

    // 6. Each <perspective> → add version="2.0"
    if (perspNode) {
        const perspectives = getChildElementsByTag(perspNode, 'perspective');
        for (const p of perspectives) {
            if (!p.getAttribute('version')) {
                p.setAttribute('version', '2.0');
            }
        }
        if (perspectives.length > 0) {
            changes.push(`Added version="2.0" to ${perspectives.length} <perspective> elements`);
        }
    }

    // 7. <layoutGroup> → add PosX/PosY/PaneWidth/PaneHeight
    const layoutGroupsNode = getOptionalElementByTag(root, 'layoutGroups');
    if (layoutGroupsNode) {
        const groups = getChildElementsByTag(layoutGroupsNode, 'layoutGroup');
        let count = 0;
        for (const lg of groups) {
            let added = false;
            for (const attr of ['PosX', 'PosY', 'PaneWidth', 'PaneHeight']) {
                if (!lg.hasAttribute(attr)) {
                    lg.setAttribute(attr, '-1');
                    added = true;
                }
            }
            if (added) count++;
        }
        if (count > 0) {
            changes.push(`Added position/size attrs to ${count} <layoutGroup> elements`);
        }
    }

    // 8. Fix "Terrian" → "Terrain" in view_objects
    const viewObjNode = getOptionalElementByTag(root, 'view_objects');
    if (viewObjNode) {
        const objs = getChildElementsByTag(viewObjNode, 'view_object');
        for (const obj of objs) {
            if (obj.getAttribute('DisplayAs') === 'Terrian') {
                obj.setAttribute('DisplayAs', 'Terrain');
                changes.push(`Fixed "Terrian" → "Terrain" on view_object "${obj.getAttribute('name') || ''}"`);
            }
        }
    }

    // 9. Add LayoutMode3D setting if missing
    const settingsNode = getOptionalElementByTag(root, 'settings');
    if (settingsNode) {
        if (!getOptionalElementByTag(settingsNode, 'LayoutMode3D')) {
            const lm3d = doc.createElement('LayoutMode3D');
            lm3d.setAttribute('value', '0');
            settingsNode.appendChild(lm3d);
            changes.push('Added LayoutMode3D setting');
        }
    }

    return { doc, effectPresetsJson, changes };
}

// ---------------------------------------------------------------------------
// Backward migration  (x2026_3 → x2026_2)
// ---------------------------------------------------------------------------

function migrateBackward(doc: Document, effectPresetsJsonStr?: string): InternalResult {
    const changes: string[] = [];
    const root = doc.documentElement;
    if (!root) throw new Error('Document has no root element');

    // 1. Remove type="rgb_effects" from <models>
    const modelsNode = getOptionalElementByTag(root, 'models');
    if (modelsNode && modelsNode.getAttribute('type') === 'rgb_effects') {
        modelsNode.removeAttribute('type');
        changes.push('Removed type="rgb_effects" from <models>');
    }

    // 2. Rename named attrs back to parm1/2/3 on each <model> + merge Tree/Sphere DisplayAs
    //    + expand CustomModelCompressed → CustomModel if needed
    //    + rename per-model upstream attrs back to legacy (Arches Arc → arc)
    //    + rename ControllerConnection upstream attrs back to legacy (Brightness, Reverse, ZigZag)
    if (modelsNode) {
        const models = getChildElementsByTag(modelsNode, 'model');
        for (const model of models) {
            // Arches: x2026_3 omits ZigZag when false, but x2026_2 readers
            // default an absent ZigZag to TRUE — materialize the explicit
            // false or the wiring flips on the legacy side. Gate on the
            // new-format marker (NumArches) so an already-legacy element
            // (where absent means true) is never touched.
            if (
                model.getAttribute('DisplayAs') === 'Arches' &&
                model.hasAttribute('NumArches') &&
                !model.hasAttribute('ZigZag')
            ) {
                model.setAttribute('ZigZag', 'false');
                changes.push(`Model "${model.getAttribute('name') || 'Arches'}": materialized implicit upstream ZigZag="false"`);
            }
            // Sphere: model versionNumber >= 8 means the scales are in the
            // "truly round" coordinate system introduced by the upstream
            // sphere fix (the ONLY semantic carried by the 7→8 bump of
            // CUR_MODEL_POS_VER).  x2026_2 builds have no v8 knowledge and
            // would render such scales at the wrong size — convert back to
            // classic semantics before handing the file over.  Must run
            // before renameParmAttrsBackward (reads the x2026_3 attr names).
            downgradeSphereV8ScalesBackward(model, changes);

            // All models: stamp the x2026_2 position-semantics version.  The
            // v8-only semantic (sphere scaling) was converted above, and
            // x2026_2 builds write versionNumber="7" themselves — leaving
            // "8" would mislabel the data after their next save.
            const mv = parseInt(model.getAttribute('versionNumber') || '');
            if (!isNaN(mv) && mv >= 8) {
                model.setAttribute('versionNumber', '7');
            }

            renameParmAttrsBackward(model, changes);
            mergeDisplayAsBackward(model, changes);
            expandCustomModelCompressed(model, changes);
            renameModelAttrsBackward(model, changes);
            renameControllerConnectionAttrsBackward(model, changes);
        }
    }

    // 3. Remove type="rgb_effects" from <modelGroups>
    const groupsNode = getOptionalElementByTag(root, 'modelGroups');
    if (groupsNode && groupsNode.getAttribute('type') === 'rgb_effects') {
        groupsNode.removeAttribute('type');
        changes.push('Removed type="rgb_effects" from <modelGroups>');
    }

    // 4. Import effect presets JSON back into XML <effects> node
    if (effectPresetsJsonStr) {
        const json: EffectPresetsJson = JSON.parse(effectPresetsJsonStr);
        const effectsEl = effectsJsonToXml(doc, json);

        // Remove any existing <effects> node first
        const existing = getOptionalElementByTag(root, 'effects');
        if (existing) root.removeChild(existing);

        // Insert after <palettes> if present, otherwise after <modelGroups>
        const palettes = getOptionalElementByTag(root, 'palettes');
        const insertAfter = palettes || groupsNode || modelsNode;
        if (insertAfter && insertAfter.nextSibling) {
            root.insertBefore(effectsEl, insertAfter.nextSibling);
        } else {
            root.appendChild(effectsEl);
        }
        changes.push(`Embedded ${countPresets(json.children)} effect presets into XML <effects> node`);
    } else {
        // Ensure an empty <effects version="0007"> node exists
        if (!getOptionalElementByTag(root, 'effects')) {
            const effectsEl = doc.createElement('effects');
            effectsEl.setAttribute('version', '0007');
            const palettes = getOptionalElementByTag(root, 'palettes');
            const insertAfter = palettes || groupsNode || modelsNode;
            if (insertAfter && insertAfter.nextSibling) {
                root.insertBefore(effectsEl, insertAfter.nextSibling);
            } else {
                root.appendChild(effectsEl);
            }
            changes.push('Added empty <effects version="0007"> node');
        }
    }

    // 5. Remove current attr from <perspectives>
    const perspNode = getOptionalElementByTag(root, 'perspectives');
    if (perspNode && perspNode.hasAttribute('current')) {
        perspNode.removeAttribute('current');
        changes.push('Removed current attribute from <perspectives>');
    }

    // 6. Remove version from each <perspective>
    if (perspNode) {
        const perspectives = getChildElementsByTag(perspNode, 'perspective');
        let count = 0;
        for (const p of perspectives) {
            if (p.hasAttribute('version')) {
                p.removeAttribute('version');
                count++;
            }
        }
        if (count > 0) {
            changes.push(`Removed version attribute from ${count} <perspective> elements`);
        }
    }

    // 7. Remove PosX/PosY/PaneWidth/PaneHeight from <layoutGroup>
    const layoutGroupsNode = getOptionalElementByTag(root, 'layoutGroups');
    if (layoutGroupsNode) {
        const groups = getChildElementsByTag(layoutGroupsNode, 'layoutGroup');
        let count = 0;
        for (const lg of groups) {
            let removed = false;
            for (const attr of ['PosX', 'PosY', 'PaneWidth', 'PaneHeight']) {
                if (lg.hasAttribute(attr)) {
                    lg.removeAttribute(attr);
                    removed = true;
                }
            }
            if (removed) count++;
        }
        if (count > 0) {
            changes.push(`Removed position/size attrs from ${count} <layoutGroup> elements`);
        }
    }

    // 8. View objects
    // 8.a. "Terrain" → "Terrian" (optional, both are read by fork)
    // 8.b. And apply version numbers
    const viewObjNode = getOptionalElementByTag(root, 'view_objects');
    if (viewObjNode) {
        const objs = getChildElementsByTag(viewObjNode, 'view_object');
        for (const obj of objs) {
            /*
            if (obj.getAttribute('DisplayAs') === 'Terrain') {
                obj.setAttribute('DisplayAs', 'Terrian');
                changes.push(`Fixed "Terrain" → "Terrian" on view_object "${obj.getAttribute('name') || ''}"`);
            }
            */
            if (!obj.hasAttribute('versionNumber')) {
                obj.setAttribute('versionNumber', '7');
            }
        }
    }

    // 9. Remove LayoutMode3D setting
    const settingsNode = getOptionalElementByTag(root, 'settings');
    if (settingsNode) {
        const lm3d = getOptionalElementByTag(settingsNode, 'LayoutMode3D');
        if (lm3d) {
            settingsNode.removeChild(lm3d);
            changes.push('Removed LayoutMode3D setting');
        }
    }

    return { doc, changes };
}

// ---------------------------------------------------------------------------
// Attribute renaming helpers
// ---------------------------------------------------------------------------

function renameParmAttrsForward(model: Element, changes: string[]): void {
    const da = model.getAttribute('DisplayAs') || '';
    const mapping = findParmMapping(da);

    const name = model.getAttribute('name') || da;
    const renamed: string[] = [];

    if (mapping) {
        for (const [parmAttr, newAttr] of Object.entries(mapping) as [string, string][]) {
            if (!newAttr) continue;
            if (model.hasAttribute(parmAttr)) {
                const value = model.getAttribute(parmAttr)!;
                model.removeAttribute(parmAttr);
                model.setAttribute(newAttr, value);
                renamed.push(`${parmAttr}→${newAttr}`);
            }
        }
    }

    // Image: upstream doesn't use parm1/2/3 — strip the vestigial fork values
    // so the migrated file matches what upstream writes. (No PARM_RENAMES entry
    // for Image, so this runs even when mapping is undefined.)
    if (da === 'Image') {
        for (const p of ['parm1', 'parm2', 'parm3']) {
            if (model.hasAttribute(p)) {
                model.removeAttribute(p);
                renamed.push(`${p} (stripped)`);
            }
        }
    }

    // DMX: parm1 was renamed to DmxChannelCount above; parm2/parm3 are
    // vestigial in the fork (always "1") and not written by upstream — strip.
    if (da.startsWith('Dmx') || da === 'DMX') {
        for (const p of ['parm2', 'parm3']) {
            if (model.hasAttribute(p)) {
                model.removeAttribute(p);
                renamed.push(`${p} (stripped)`);
            }
        }
    }

    // Custom/Icicles/Wreath: parm3 is vestigial (always "1") — upstream omits it.
    if ((da === 'Custom' || da === 'Icicles' || da === 'Wreath') && model.hasAttribute('parm3')) {
        model.removeAttribute('parm3');
        renamed.push(`parm3 (stripped)`);
    }

    // Poly Line: upstream encodes individual-segment mode implicitly by
    // emitting Seg1..SegN only when !autoDistribute (BaseSerializingVisitor.cpp:869).
    // It does not write a separate IndivSegs flag — strip the legacy one.
    if (da === 'Poly Line' && model.hasAttribute('IndivSegs')) {
        model.removeAttribute('IndivSegs');
        renamed.push(`IndivSegs (stripped)`);
    }

    if (renamed.length > 0) {
        changes.push(`Model "${name}": renamed ${renamed.join(', ')}`);
    }
}

function renameParmAttrsBackward(model: Element, changes: string[]): void {
    const da = model.getAttribute('DisplayAs') || '';
    const mapping = findParmMapping(da);

    const name = model.getAttribute('name') || da;
    const renamed: string[] = [];

    if (mapping) {
        const reverse = buildReverseParmLookup(mapping);
        for (const [namedAttr, parmAttr] of Object.entries(reverse)) {
            if (model.hasAttribute(namedAttr)) {
                const value = model.getAttribute(namedAttr)!;
                model.removeAttribute(namedAttr);
                model.setAttribute(parmAttr, value);
                renamed.push(`${namedAttr}→${parmAttr}`);
            }
        }
    }

    // Poly Line: parm1 is not in the rename mapping (upstream doesn't write it)
    // but old code needs it — default to "1"
    if (da === 'Poly Line' && !model.hasAttribute('parm1')) {
        model.setAttribute('parm1', '1');
        renamed.push('parm1=1 (default)');
    }

    // Poly Line: upstream signals "individual segments" mode by writing Seg1,
    // Seg2, ... attributes (BaseSerializingVisitor.cpp:869: only emitted when
    // !GetAutoDistribute()).  Reading: XmlDeserializingModelFactory.cpp:724
    // sets _autoDistributeLights = false iff Seg1 is non-empty.  Old xLights
    // requires the explicit IndivSegs="1" master flag — without it, segment
    // sizes are present but ignored.  Detect Seg1 presence and set the flag.
    if (da === 'Poly Line' && !model.hasAttribute('IndivSegs')) {
        const seg1 = model.getAttribute('Seg1');
        if (seg1 !== null && seg1 !== '') {
            model.setAttribute('IndivSegs', '1');
            renamed.push('IndivSegs=1 (Seg1 present)');
        }
    }

    // Image: upstream doesn't write parm1/2/3, but old xLights treats absent
    // parm1/2/3 as a 0-string model and gets confused. Default all three to "1".
    if (da === 'Image') {
        for (const p of ['parm1', 'parm2', 'parm3']) {
            if (!model.hasAttribute(p)) {
                model.setAttribute(p, '1');
                renamed.push(`${p}=1 (default)`);
            }
        }
    }

    // DMX: upstream omits parm2/parm3 (only parm1↔DmxChannelCount round-trips).
    // Old xLights InitModel hardcodes them to "1" — write the defaults so old
    // code doesn't see zero strings.
    if (da.startsWith('Dmx') || da === 'DMX') {
        for (const p of ['parm2', 'parm3']) {
            if (!model.hasAttribute(p)) {
                model.setAttribute(p, '1');
                renamed.push(`${p}=1 (default)`);
            }
        }
    }

    // Custom/Icicles/Wreath: upstream omits parm3 (vestigial), but old fork
    // models always wrote "1" — restore so old xLights doesn't see zero.
    if ((da === 'Custom' || da === 'Icicles' || da === 'Wreath') && !model.hasAttribute('parm3')) {
        model.setAttribute('parm3', '1');
        renamed.push(`parm3=1 (default)`);
    }

    if (renamed.length > 0) {
        changes.push(`Model "${name}": renamed ${renamed.join(', ')}`);
    }
}

/**
 * Find the per-model attribute rename mapping for a DisplayAs value.
 * Handles Tree/Sphere variants by stripping suffix and looking up the base.
 */
function findModelAttrRenames(displayAs: string): Record<string, string> | undefined {
    if (MODEL_ATTR_RENAMES[displayAs]) return MODEL_ATTR_RENAMES[displayAs];
    if (displayAs.startsWith('Tree ') && MODEL_ATTR_RENAMES['Tree']) return MODEL_ATTR_RENAMES['Tree'];
    if (displayAs.startsWith('Sphere ') && MODEL_ATTR_RENAMES['Sphere']) return MODEL_ATTR_RENAMES['Sphere'];
    return undefined;
}

/**
 * Forward: rename legacy camelCase attributes on the model element to their
 * upstream PascalCase equivalents.  E.g. Arches arc → Arc.
 */
function renameModelAttrsForward(model: Element, changes: string[]): void {
    const da = model.getAttribute('DisplayAs') || '';
    const mapping = findModelAttrRenames(da);
    if (!mapping) return;

    const name = model.getAttribute('name') || da;
    const renamed: string[] = [];

    for (const [legacyName, upstreamName] of Object.entries(mapping)) {
        if (model.hasAttribute(legacyName)) {
            const value = model.getAttribute(legacyName)!;
            model.removeAttribute(legacyName);
            model.setAttribute(upstreamName, value);
            renamed.push(`${legacyName}→${upstreamName}`);
        }
    }

    if (renamed.length > 0) {
        changes.push(`Model "${name}": renamed ${renamed.join(', ')}`);
    }
}

/**
 * Backward: rename upstream PascalCase attributes on the model element back
 * to their legacy camelCase form.  E.g. Arches Arc → arc.
 */
function renameModelAttrsBackward(model: Element, changes: string[]): void {
    const da = model.getAttribute('DisplayAs') || '';
    const mapping = findModelAttrRenames(da);
    if (!mapping) return;

    const name = model.getAttribute('name') || da;
    const renamed: string[] = [];

    for (const [legacyName, upstreamName] of Object.entries(mapping)) {
        if (model.hasAttribute(upstreamName)) {
            const value = model.getAttribute(upstreamName)!;
            model.removeAttribute(upstreamName);
            model.setAttribute(legacyName, value);
            renamed.push(`${upstreamName}→${legacyName}`);
        }
    }

    if (renamed.length > 0) {
        changes.push(`Model "${name}": renamed ${renamed.join(', ')}`);
    }
}

/**
 * Forward: rename legacy camelCase attributes on any <ControllerConnection>
 * child of the model to their upstream PascalCase form.
 */
function renameControllerConnectionAttrsForward(model: Element, changes: string[]): void {
    const ccElements = getChildElementsByTag(model, 'ControllerConnection');
    if (ccElements.length === 0) return;

    const name = model.getAttribute('name') || model.getAttribute('DisplayAs') || '';
    const renamed: string[] = [];

    for (const cc of ccElements) {
        for (const [legacyName, upstreamName] of Object.entries(CONTROLLER_CONNECTION_RENAMES)) {
            if (cc.hasAttribute(legacyName)) {
                const value = cc.getAttribute(legacyName)!;
                cc.removeAttribute(legacyName);
                cc.setAttribute(upstreamName, value);
                renamed.push(`${legacyName}→${upstreamName}`);
            }
        }
    }

    if (renamed.length > 0) {
        changes.push(`Model "${name}" ControllerConnection: renamed ${renamed.join(', ')}`);
    }
}

/**
 * Backward: rename upstream PascalCase attributes on any <ControllerConnection>
 * child of the model back to their legacy camelCase form.
 */
function renameControllerConnectionAttrsBackward(model: Element, changes: string[]): void {
    const ccElements = getChildElementsByTag(model, 'ControllerConnection');
    if (ccElements.length === 0) return;

    const name = model.getAttribute('name') || model.getAttribute('DisplayAs') || '';
    const renamed: string[] = [];

    for (const cc of ccElements) {
        for (const [legacyName, upstreamName] of Object.entries(CONTROLLER_CONNECTION_RENAMES)) {
            if (cc.hasAttribute(upstreamName)) {
                const value = cc.getAttribute(upstreamName)!;
                cc.removeAttribute(upstreamName);
                cc.setAttribute(legacyName, value);
                renamed.push(`${upstreamName}→${legacyName}`);
            }
        }
    }

    if (renamed.length > 0) {
        changes.push(`Model "${name}" ControllerConnection: renamed ${renamed.join(', ')}`);
    }
}

// ---------------------------------------------------------------------------
// Per-model-element forward normalization (native parsing support)
// ---------------------------------------------------------------------------

/**
 * Normalize a single <model> element to canonical x2026.3+ form, in place.
 */
export function normalizeModelElementForward(model: Element): void {
    const changes: string[] = [];
    forwardMigrateModelElement(model, changes);
}

/**
 * The complete per-model forward (x2026_2 → x2026_3) transform. Shared by
 * document-level migrateForward() and per-element normalizeModelElementForward()
 * so the two paths cannot drift. Idempotent: every step is gated on
 * legacy-only markers and no-ops on new-format input.
 */
function forwardMigrateModelElement(model: Element, changes: string[]): void {
    // Poly Line: the x2026_2 format gates individual-segments mode on an
    // explicit IndivSegs="1" master flag (SegN attrs can linger in the XML
    // when the box is unchecked, since legacy xLights edits model nodes in
    // place); the new format encodes the mode implicitly — Seg1 non-empty ⇔
    // individual segments (upstream XmlDeserializingModelFactory
    // DeserializePolyLine). Before renameParmAttrsForward strips the legacy
    // flag, drop stale SegN attrs when the flag says auto-distribute so the
    // implicit encoding the parser relies on stays truthful.
    if (model.getAttribute('DisplayAs') === 'Poly Line' && model.hasAttribute('IndivSegs')) {
        // Same truthiness set as the model-binding BOOL parser ('1'/'true'/'t'/'yes').
        const indiv = (model.getAttribute('IndivSegs') || '').toLowerCase();
        if (indiv !== '1' && indiv !== 'true' && indiv !== 't' && indiv !== 'yes') {
            for (let i = 1; model.hasAttribute(`Seg${i}`); i++) {
                model.removeAttribute(`Seg${i}`);
            }
        }
    }

    // Arches: the two formats read an ABSENT ZigZag attribute with opposite
    // defaults — x2026_2 readers default to true (arches physically zig-zag
    // by default; the attribute was added later to make that optional), while
    // x2026_3 defaults to false and only serializes the attribute when true
    // (ArchesModel.h `_zigzag = false`, BaseSerializingVisitor writes it only
    // when set). An implicit legacy value must therefore be materialized on
    // forward migration or every implicitly-zig-zag arch silently flips.
    // Gate on parm1, which every x2026_2 model carries and no x2026_3 model
    // does — an x2026_3 arches element without ZigZag legitimately means
    // false and must NOT be touched.
    if (
        model.getAttribute('DisplayAs') === 'Arches' &&
        model.hasAttribute('parm1') &&
        !model.hasAttribute('ZigZag')
    ) {
        model.setAttribute('ZigZag', 'true');
        changes.push(`Model "${model.getAttribute('name') || 'Arches'}": materialized implicit legacy ZigZag="true"`);
    }

    renameParmAttrsForward(model, changes);
    splitDisplayAsForward(model, changes);
    renameModelAttrsForward(model, changes);
    renameControllerConnectionAttrsForward(model, changes);

    // versionNumber (CUR_MODEL_POS_VER) upgrade: v7 → v8.  The only semantic
    // carried by the 7→8 bump is the sphere scale fix, so a v7 sphere gets
    // its scales converted and every other v7 model is vacuously at v8
    // semantics already — both are then honestly stamped "8", telling
    // x2026_3 readers NOT to re-run that upgrade.  Files below v7 pass
    // through untouched (stamp and values): the older rungs (e.g. the v2→3
    // percent-to-world position conversion) need document context like
    // preview dimensions that a per-element transform doesn't have, and the
    // preserved stamp makes x2026_3 readers run their own ladder at load.
    // Runs AFTER the renames — the sphere upgrade reads x2026_3 attr names.
    const mposv = parseInt(model.getAttribute('versionNumber') || '');
    if (mposv === 7) {
        upgradeSphereV7ScalesForward(model, changes);
        model.setAttribute('versionNumber', '8');
    }
}

// ---------------------------------------------------------------------------
// DisplayAs normalization: Tree, Sphere, Matrix
//
// The fork encodes variant info in the DisplayAs string itself:
//   "Tree 360", "Tree Flat", "Horiz Matrix", "Sphere 270"
//
// The upstream normalizes to a single canonical DisplayAs and uses
// separate attributes for the variant:
//   "Tree"   + TreeType + TreeDegrees
//   "Matrix" + VertMatrix
//   "Sphere" + Degrees
// ---------------------------------------------------------------------------

/**
 * Forward: split combined DisplayAs values into canonical form + separate attrs.
 * No-ops on values that are already in upstream form.
 */
function splitDisplayAsForward(model: Element, changes: string[]): void {
    const da = model.getAttribute('DisplayAs') || '';
    const name = model.getAttribute('name') || da;

    // --- Tree ---
    if (da === 'Tree Flat') {
        model.setAttribute('DisplayAs', 'Tree');
        model.setAttribute('TreeType', '1');
        if (!model.hasAttribute('TreeDegrees')) model.setAttribute('TreeDegrees', '0');
        changes.push(`Model "${name}": split DisplayAs="Tree Flat" → Tree + TreeType=1`);
    } else if (da === 'Tree Ribbon') {
        model.setAttribute('DisplayAs', 'Tree');
        model.setAttribute('TreeType', '2');
        if (!model.hasAttribute('TreeDegrees')) model.setAttribute('TreeDegrees', '-1');
        changes.push(`Model "${name}": split DisplayAs="Tree Ribbon" → Tree + TreeType=2`);
    } else if (da.startsWith('Tree ')) {
        const degStr = da.substring(5).trim();
        const deg = parseInt(degStr);
        if (!isNaN(deg)) {
            model.setAttribute('DisplayAs', 'Tree');
            model.setAttribute('TreeType', '0');
            model.setAttribute('TreeDegrees', String(deg));
            changes.push(`Model "${name}": split DisplayAs="${da}" → Tree + TreeDegrees=${deg}`);
        }
    }

    // --- Matrix ---
    // Upstream uses attribute name "Vertical" (not "VertMatrix") per XmlNodeKeys.h
    if (da === 'Vert Matrix') {
        model.setAttribute('DisplayAs', 'Matrix');
        model.setAttribute('Vertical', 'true');
        changes.push(`Model "${name}": split DisplayAs="Vert Matrix" → Matrix + Vertical=true`);
    } else if (da === 'Horiz Matrix') {
        model.setAttribute('DisplayAs', 'Matrix');
        model.setAttribute('Vertical', 'false');
        changes.push(`Model "${name}": split DisplayAs="Horiz Matrix" → Matrix + Vertical=false`);
    }

    // --- Sphere ---
    // The fork already uses DisplayAs="Sphere" + separate Degrees attribute.
    // No forward split needed for Sphere (unlike Tree/Matrix).

    // --- Window Frame Rotation value rename ---
    const rot = model.getAttribute('Rotation');
    if (rot === 'CW') {
        model.setAttribute('Rotation', 'Clockwise');
        changes.push(`Model "${name}": Rotation "CW" → "Clockwise"`);
    } else if (rot === 'CCW') {
        model.setAttribute('Rotation', 'Counter Clockwise');
        changes.push(`Model "${name}": Rotation "CCW" → "Counter Clockwise"`);
    }
}

/**
 * Backward: merge canonical DisplayAs + separate attrs back into combined form.
 * No-ops on values that are already in fork form.
 */
function mergeDisplayAsBackward(model: Element, changes: string[]): void {
    const da = model.getAttribute('DisplayAs') || '';
    const name = model.getAttribute('name') || da;

    // --- Tree ---
    if (da === 'Tree' && (model.hasAttribute('TreeType') || model.hasAttribute('TreeDegrees'))) {
        const treeType = parseInt(model.getAttribute('TreeType') || '0');
        const degrees = parseInt(model.getAttribute('TreeDegrees') || '360');

        let newDa: string;
        if (treeType === 1) {
            newDa = 'Tree Flat';
        } else if (treeType === 2) {
            newDa = 'Tree Ribbon';
        } else {
            newDa = `Tree ${degrees > 1 ? degrees : 180}`;
        }

        model.setAttribute('DisplayAs', newDa);
        model.removeAttribute('TreeType');
        model.removeAttribute('TreeDegrees');
        changes.push(`Model "${name}": merged Tree + TreeType=${treeType} → DisplayAs="${newDa}"`);
    }

    // --- Matrix ---
    // Upstream uses attribute name "Vertical" (not "VertMatrix") per XmlNodeKeys.h
    if (da === 'Matrix') {
        const isVert = model.getAttribute('Vertical') === 'true';
        const newDa = isVert ? 'Vert Matrix' : 'Horiz Matrix';
        model.setAttribute('DisplayAs', newDa);
        if (model.hasAttribute('Vertical')) model.removeAttribute('Vertical');
        changes.push(`Model "${name}": merged Matrix → DisplayAs="${newDa}"`);
    }

    // --- Sphere ---
    // The fork already uses DisplayAs="Sphere" + separate Degrees attribute.
    // Unlike Tree, sphere degrees were never encoded into DisplayAs in the fork.
    // No backward merge needed for Sphere.

    // --- Window Frame Rotation value rename ---
    // Upstream normalized "CW" → "Clockwise" but kept "Counter Clockwise" as-is.
    // So backward only needs to revert "Clockwise" → "CW".
    const rotB = model.getAttribute('Rotation');
    if (rotB === 'Clockwise') {
        model.setAttribute('Rotation', 'CW');
        changes.push(`Model "${name}": Rotation "Clockwise" → "CW"`);
    }
}

// ---------------------------------------------------------------------------
// CustomModelCompressed → CustomModel expansion
// ---------------------------------------------------------------------------

/**
 * True if a CustomModel/CustomModelCompressed attribute value contains any
 * actual node numbers.  A missing or empty attribute has none, but so does a
 * degenerate uncompressed grid like ",,;,," (all cells empty).
 */
export function customModelDataHasNodes(data: string): boolean {
    return /\d/.test(data);
}

/**
 * Expand the compressed custom-model format into the uncompressed format.
 *
 * Compressed format: "node,row,col[,layer];..." (sparse, only populated cells)
 * Uncompressed format: rows of comma-separated node numbers, ';' between rows, '|' between layers
 *   (empty cells are empty strings between commas)
 *
 * width/height/depth are the model's declared grid dimensions (CustomWidth/parm1
 * etc.); pass 0 for unknown and the grid is sized from the data itself.
 * Returns '' if the compressed data contains no valid entries.
 */
export function expandCompressedCustomModel(compressed: string, width = 0, height = 0, depth = 0): string {
    // Parse compressed: each entry is "node,row,col" or "node,row,col,layer"
    const entries: { node: number; row: number; col: number; layer: number }[] = [];
    for (const part of compressed.split(';')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const fields = trimmed.split(',');
        if (fields.length >= 3) {
            entries.push({
                node: parseInt(fields[0]),
                row: parseInt(fields[1]),
                col: parseInt(fields[2]),
                layer: fields.length >= 4 ? parseInt(fields[3]) : 0,
            });
        }
    }

    if (entries.length === 0) return '';

    // Use model dimensions if available, fall back to scanning entries
    let maxCol = width > 0 ? width - 1 : 0;
    let maxRow = height > 0 ? height - 1 : 0;
    let maxLayer = depth > 0 ? depth - 1 : 0;

    // Ensure dimensions cover all entries (safety net)
    for (const e of entries) {
        if (e.row > maxRow) maxRow = e.row;
        if (e.col > maxCol) maxCol = e.col;
        if (e.layer > maxLayer) maxLayer = e.layer;
    }

    // Build layers of row strings
    const layerStrings: string[] = [];
    for (let l = 0; l <= maxLayer; l++) {
        // Create empty grid
        const grid: string[][] = [];
        for (let r = 0; r <= maxRow; r++) {
            const row: string[] = [];
            for (let c = 0; c <= maxCol; c++) {
                row.push('');
            }
            grid.push(row);
        }
        // Fill in nodes for this layer
        for (const e of entries) {
            if (e.layer === l) {
                grid[e.row][e.col] = String(e.node);
            }
        }
        // Convert to string: rows joined by ';'
        const rowStrings = grid.map(row => row.join(','));
        layerStrings.push(rowStrings.join(';'));
    }

    // Layers joined by '|'
    return layerStrings.join('|');
}

/**
 * If a Custom model element carries real pixel data only in
 * CustomModelCompressed (CustomModel absent, empty — as newer xLights writes —
 * or degenerate), expand it into CustomModel so code that reads only the
 * uncompressed attribute sees the pixel data.
 *
 * Works on <model DisplayAs="Custom"> elements from a layout and on
 * <custommodel> root elements from .xmodel files.
 * Returns true if the element was updated.
 */
export function normalizeCustomModelPixelData(model: Element): boolean {
    const isCustom = model.tagName === 'custommodel' || model.getAttribute('DisplayAs') === 'Custom';
    if (!isCustom) return false;
    if (customModelDataHasNodes(model.getAttribute('CustomModel') || '')) return false;
    const compressed = model.getAttribute('CustomModelCompressed') || '';
    if (!customModelDataHasNodes(compressed)) return false;

    const width = parseInt(model.getAttribute('CustomWidth') || model.getAttribute('parm1') || '') || 0;
    const height = parseInt(model.getAttribute('CustomHeight') || model.getAttribute('parm2') || '') || 0;
    const depth = parseInt(model.getAttribute('Depth') || '') || 0;

    const expanded = expandCompressedCustomModel(compressed, width, height, depth);
    if (!expanded) return false;
    model.setAttribute('CustomModel', expanded);
    return true;
}

/**
 * Normalize every <model> and <custommodel> element in a document.
 * Returns the number of elements updated.
 */
export function normalizeAllCustomModelPixelData(doc: Document): number {
    let count = 0;
    for (const tag of ['model', 'custommodel']) {
        const els = doc.getElementsByTagName(tag);
        for (let i = 0; i < els.length; i++) {
            if (normalizeCustomModelPixelData(els[i] as Element)) count++;
        }
    }
    return count;
}

function expandCustomModelCompressed(model: Element, changes: string[]): void {
    if (model.getAttribute('DisplayAs') !== 'Custom') return;
    if (normalizeCustomModelPixelData(model)) {
        const name = model.getAttribute('name') || 'Custom';
        changes.push(`Model "${name}": expanded CustomModelCompressed → CustomModel`);
    }
}

// ---------------------------------------------------------------------------
// Sphere versionNumber-8 scale semantics
// ---------------------------------------------------------------------------

/**
 * Scale factors between the classic (versionNumber <= 7) and "truly round"
 * (versionNumber >= 8) sphere coordinate systems.  Upstream's legacy upgrade
 * (XmlDeserializingModelFactory::DeserializeSphere) MULTIPLIES classic scales
 * by these to get v8 scales; DIVIDE v8 scales by them to get classic.
 * Returns undefined when the buffer dimensions are degenerate.
 * Defaults mirror the SphereModel class (numStrings 8, pixelsPerString 50,
 * strandsPerString 1).
 */
export function sphereV8ScaleFactors(
    numStrings: number,
    pixelsPerString: number,
    strandsPerString: number,
): { xz: number; y: number } | undefined {
    let strands = strandsPerString < 1 ? 1 : strandsPerString;
    if (strands > pixelsPerString) strands = pixelsPerString;
    const bufferHt = strands > 0 ? Math.floor(pixelsPerString / strands) : pixelsPerString;
    const bufferWi = numStrings * strands;
    const mx = Math.max(bufferHt, bufferWi);
    if (mx <= 0) return undefined;
    const htOverMax = bufferHt / mx;
    return { xz: htOverMax / 1.8, y: htOverMax };
}

/** Read the sphere dimension attrs (x2026_3 names) and compute the v7↔v8
 *  scale factors; undefined when not applicable. */
function sphereV8FactorsFromElement(model: Element): { xz: number; y: number } | undefined {
    const numStrings = parseInt(model.getAttribute('NumStrings') || '') || 8;
    const pixelsPerString = parseInt(model.getAttribute('NodesPerString') || '') || 50;
    const strandsPerString = parseInt(model.getAttribute('StrandsPerString') || '') || 1;
    return sphereV8ScaleFactors(numStrings, pixelsPerString, strandsPerString);
}

function scaleAttr(model: Element, attr: string, mulOrDiv: (v: number) => number): void {
    const v = Number.parseFloat(model.getAttribute(attr) || '1');
    const converted = mulOrDiv(Number.isFinite(v) ? v : 1);
    model.setAttribute(attr, converted.toFixed(6));
}

/**
 * Forward-migration step: upgrade a v7 Sphere's scales to the v8 "truly
 * round" coordinate system (the same transform upstream's DeserializeSphere
 * applies to sub-8 files at load).  Reads x2026_3 attribute names — call
 * after renameParmAttrsForward.  versionNumber is stamped by the caller.
 */
function upgradeSphereV7ScalesForward(model: Element, changes: string[]): void {
    if (model.getAttribute('DisplayAs') !== 'Sphere') return;
    const f = sphereV8FactorsFromElement(model);
    if (!f) return;
    scaleAttr(model, 'ScaleX', (v) => v * f.xz);
    scaleAttr(model, 'ScaleZ', (v) => v * f.xz);
    scaleAttr(model, 'ScaleY', (v) => v * f.y);
    changes.push(
        `Model "${model.getAttribute('name') || 'Sphere'}": upgraded v7 sphere scales to v8 semantics`,
    );
}

/**
 * Backward-migration step: convert a Sphere model's versionNumber>=8 scales
 * back to classic semantics so x2026_2 builds (which have no v8 knowledge)
 * render it at the right size.  Reads the x2026_3 attribute names — call
 * before renameParmAttrsBackward.  versionNumber itself is reset by the
 * caller after this runs.
 */
function downgradeSphereV8ScalesBackward(model: Element, changes: string[]): void {
    if (model.getAttribute('DisplayAs') !== 'Sphere') return;
    const version = parseInt(model.getAttribute('versionNumber') || '');
    if (isNaN(version) || version < 8) return;

    const f = sphereV8FactorsFromElement(model);
    if (!f) return;
    scaleAttr(model, 'ScaleX', (v) => v / f.xz);
    scaleAttr(model, 'ScaleZ', (v) => v / f.xz);
    scaleAttr(model, 'ScaleY', (v) => v / f.y);
    changes.push(
        `Model "${model.getAttribute('name') || 'Sphere'}": converted v8 sphere scales back to classic semantics`,
    );
}

// ---------------------------------------------------------------------------
// Parm mapping lookup
// ---------------------------------------------------------------------------

/**
 * Normalize a fork DisplayAs into its canonical base type.
 *   "Tree 360" / "Tree Flat" / "Tree Ribbon" → "Tree"
 *   "Sphere 270"                              → "Sphere"
 *   "Horiz Matrix" / "Vert Matrix"            → "Matrix"
 *   "DmxFloodArea" / "DmxMovingHead" / "DMX"  → "Dmx"
 * Anything already canonical (or unrelated) is returned unchanged.
 *
 * Use this when you need to dispatch on model family rather than the exact
 * fork variant string (e.g. test rule predicates).
 */
export function getBaseDisplayAs(displayAs: string): string {
    if (displayAs === 'Tree' || displayAs.startsWith('Tree ')) return 'Tree';
    if (displayAs === 'Sphere' || displayAs.startsWith('Sphere ')) return 'Sphere';
    if (displayAs === 'Horiz Matrix' || displayAs === 'Vert Matrix') return 'Matrix';
    if (displayAs === 'DMX' || displayAs.startsWith('Dmx')) return 'Dmx';
    return displayAs;
}

/**
 * Find the parm mapping for a DisplayAs value.
 * Handles Tree variants like "Tree 360", "Tree 270", etc.
 */
function findParmMapping(displayAs: string): ParmMapping | undefined {
    // Direct lookup
    if (PARM_RENAMES[displayAs]) return PARM_RENAMES[displayAs];

    // Tree with degree suffix (e.g., "Tree 360", "Tree 45")
    if (displayAs.startsWith('Tree ')) return PARM_RENAMES['Tree'];

    // Sphere with degree suffix
    if (displayAs.startsWith('Sphere ')) return PARM_RENAMES['Sphere'];

    // DMX family — every DisplayAs starts with "Dmx" (DmxFloodArea, DmxFloodlight,
    // DmxGeneral, DmxMovingHead, DmxMovingHeadAdv, DmxServo, DmxServo3d, DmxSkull,
    // DmxSkulltronix fork-only) plus the uppercase 'DMX' base-model fallback.
    // All share parm1 → DmxChannelCount; parm2/parm3 are vestigial.
    if (displayAs.startsWith('Dmx') || displayAs === 'DMX') return PARM_RENAMES['Dmx'];

    return undefined;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function countPresets(items: EffectPresetItem[]): number {
    let count = 0;
    for (const item of items) {
        if (item.type === 'effect') {
            count++;
        } else {
            count += countPresets(item.children);
        }
    }
    return count;
}
