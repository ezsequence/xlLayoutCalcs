import { getAttrDef, getIntAttrDef, getNumAttrDef, getOptionalElementByTag } from "./utils";
import { parseMhDefinition } from "./mhdef";
import { ArchModel } from "./arch";
import { CandyCaneModel } from "./candycane";
import { ChannelBlockModel } from "./channelblock";
import { CircleModel } from "./circle";
import { CubeModel } from "./cube";
import { CustomModel } from "./custom";
import { DmxModel } from "./dmx";
import { IciclesModel } from "./icicles";
import { ImageModel } from "./image";
import { MatrixModel } from "./matrix";
import { PolyLineModel } from "./polyline";
import { SingleLineModel } from "./singleline";
import { SphereModel } from "./sphere";
import { SpinnerModel } from "./spinner";
import { StarModel } from "./star";
import { TreeModel } from "./tree";
import { WindowFrameModel } from "./windowframe";
import { WreathModel } from "./wreath";
import { ModelProperty } from "./modelbase";
import { BaseModelClass } from "./modelshared";
import { normalizeModelElementForward, sphereV8ScaleFactors } from "./xmlmigrate";

function setField(
    obj: Record<string, unknown>, // Dynamically typed object
    fieldName: string,
    value: unknown
) : void
{
    // Check the type compatibility
    const currentValue = obj[fieldName];
    if (currentValue !== undefined && typeof currentValue !== typeof value) {
        throw new TypeError(
            `Type mismatch for field "${fieldName}". Expected ${typeof currentValue}, got ${typeof value}.`
        );
    }

    // Set the value
    obj[fieldName] = value;
}

/**
 * Caller-controlled options for model parsing / coordinate calculation.
 * All fields are optional; callers like the in-tree dev tools can leave them
 * unset (defaults: warn on unused XML attrs, log via `console.log`).  Embedders
 * shipping to end users typically pass `{warnUnusedAttrs: false}` since these
 * warnings are only actionable inside xllayoutcalcs itself.
 */
export interface ModelParseOptions {
    /** Warn (via `logger`) about XML attributes the parser didn't consume.
     *  Default: true. */
    warnUnusedAttrs?: boolean;
    /** Sink for parser-emitted warnings.  Default: `console.log`. */
    logger?: (msg: string) => void;
}

export function createModelFromXml(mxml: Element, options?: ModelParseOptions): BaseModelClass {
    // Normalize old-format (<2026.2) input to canonical (>x2026.3) form first
    //   but the caller's element is not mutated.
    mxml = mxml.cloneNode(true) as Element;
    normalizeModelElementForward(mxml);

    const da = getAttrDef(mxml, 'DisplayAs', '<unknown>');
    let m: BaseModelClass | undefined = undefined;

    if (da === 'Arches') {
        m = new ArchModel();
    } else if (da === 'Single Line') {
        m = new SingleLineModel();
    } else if (da === 'Circle') {
        m = new CircleModel();
    } else if (da === 'Wreath') {
        m = new WreathModel();
    } else if (da === 'Star') {
        m = new StarModel();
    } else if (da === 'Candy Canes') {
        m = new CandyCaneModel();
    } else if (da === 'Icicles') {
        m = new IciclesModel();
    } else if (da === 'Spinner') {
        m = new SpinnerModel();
    } else if (da === 'Sphere' || da.startsWith('Sphere ')) {
        m = new SphereModel();
    } else if (da === 'Window Frame') {
        m = new WindowFrameModel();
    } else if (da === 'Matrix') {
        m = new MatrixModel();
    } else if (da === 'Tree' || da.startsWith('Tree ')) {
        m = new TreeModel();
    } else if (da === 'Cube') {
        m = new CubeModel();
    } else if (da === 'Custom') {
        m = new CustomModel();
    } else if (da === 'Poly Line') {
        m = new PolyLineModel();
    } else if (da === 'Channel Block') {
        m = new ChannelBlockModel();
    } else if (da === 'Image') {
        m = new ImageModel();
    } else if (da === 'DMX' || da.startsWith('Dmx')) {
        // DMX models include: DMX, DmxFloodArea, DmxFloodlight, DmxGeneral,
        // DmxMovingHead, DmxMovingHeadAdv, DmxServo, DmxServo3d, DmxSkull, DmxSkulltronix
        const dm = new DmxModel();
        dm.dmxStyle = da;  // Store the specific DMX style
        m = dm;
    }

    if (!m) throw new Error(`Unable to create model ${da}`);

    // Bind XML attributes to model fields.
    const usedTags: Set<string> = new Set();
    for (const mp of [...baseModelProperties, ...m.getProperties()]) {
        if (mp.fieldName) {
            if (!(mp.fieldName in m)) {
                console.log(`Warning: field ${mp.fieldName} not in model ${da}`);
            }
            if (!mxml.hasAttribute(mp.xmlName)) {
                //console.log(`Note: Object does not have value for ${mp.xmlName}`);
                // This would be defaulted
                continue;
            }
            switch (mp.ptype) {
                case "STRING": {
                    const vs = getAttrDef(mxml, mp.xmlName, '');
                    setField(m as unknown as Record<string, unknown>, mp.fieldName, vs);
                    break;
                }
                case "FLOAT": {
                    const vf = getNumAttrDef(mxml, mp.xmlName, 0);
                    setField(m as unknown as Record<string, unknown>, mp.fieldName, vf);
                    break;
                }
                case "INTEGER": {
                    const vi = getIntAttrDef(mxml, mp.xmlName, 0);
                    setField(m as unknown as Record<string, unknown>, mp.fieldName, vi);
                    break;
                }
                case "BOOL": {
                    let vb = false;
                    const vbs = getAttrDef(mxml, mp.xmlName, 'false');
                    if (vbs.toLowerCase() === 'true') vb = true;
                    if (vbs.toLowerCase() === 't') vb = true;
                    if (vbs.toLowerCase() === 'yes') vb = true;
                    if (vbs.toLowerCase() === '1') vb = true;
                    setField(m as unknown as Record<string, unknown>, mp.fieldName, vb);
                    break;
                }
                case "NODE_ARRAY": {
                    const vvi: number[] = [];
                    const raw = getAttrDef(mxml, mp.xmlName, '').trim();
                    if (raw.length > 0) {
                        for (const v of raw.split(',')) {
                            vvi.push(parseInt(v));
                        }
                    }
                    setField(m as unknown as Record<string, unknown>, mp.fieldName, vvi);
                    break;
                }
            }
            usedTags.add(mp.xmlName);
        }
    }

    // Handle dynamic properties for PolyLine model (Seg1, Seg2, ... and Corner1, Corner2, ...)
    if (m instanceof PolyLineModel) {
        const polyModel = m as PolyLineModel;
        const numPoints = polyModel.numPoints || 2;
        const numSegments = numPoints - 1;

        // Individual-segments mode is encoded implicitly in canonical form.
        polyModel.hasIndivSeg = (mxml.getAttribute('Seg1') ?? '') !== '';

        // Parse Seg1, Seg2, ... SegN (segment sizes)
        // Use numPoints as the upper bound to be tolerant of legacy layouts
        for (let i = 0; i < numPoints; i++) {
            const segAttr = `Seg${i + 1}`;
            if (mxml.hasAttribute(segAttr)) {
                const segValue = getIntAttrDef(mxml, segAttr, 0);
                polyModel.segmentSizes.set(i, segValue);
                usedTags.add(segAttr);
            }
        }

        // Parse Corner1, Corner2, ... CornerN+1 (corner settings)
        for (let i = 0; i <= numSegments; i++) {
            const cornerAttr = `Corner${i + 1}`;
            if (mxml.hasAttribute(cornerAttr)) {
                const cornerValue = getAttrDef(mxml, cornerAttr, 'Neither');
                polyModel.cornerSettings.set(i, cornerValue);
                usedTags.add(cornerAttr);
            }
        }

        // Parse PolyNode1, PolyNode2, ... PolyNodeN (node counts per string)
        const numStrings = polyModel.polyStrings || 1;
        for (let i = 0; i < numStrings; i++) {
            const polyNodeAttr = `PolyNode${i + 1}`;
            if (mxml.hasAttribute(polyNodeAttr)) {
                const nodeCount = getIntAttrDef(mxml, polyNodeAttr, 0);
                polyModel.polyNodeCounts.set(i, nodeCount);
                usedTags.add(polyNodeAttr);
            }
        }
    }

    // Handle dynamic properties for Custom model (NodeStart1, NodeStart2, ... NodeStartN)
    if (m instanceof CustomModel) {
        const customModel = m as CustomModel;

        // Parse NodeStart1, NodeStart2, ... NodeStartN (starting node numbers
        // per string).  Both formats use this name — fork and upstream agree
        // on CustomModel::StartNodeAttrName = "NodeStart" + (idx + 1).
        // Old non-advanced multi-string customs may instead carry String1..N
        // (upstream DeserializeCustom falls back to those as start NODES when
        // Advanced is off; when Advanced is on, String<N> means per-string
        // start CHANNELS and is handled by the base-model parsing below).
        const numStrings = customModel.numStrings || 1;
        for (let i = 0; i <= Math.max(numStrings, 50); i++) {
            const nodeStartAttr = `NodeStart${i + 1}`;
            const legacyAttr = `String${i + 1}`;
            if (mxml.hasAttribute(nodeStartAttr)) {
                const startNode = getIntAttrDef(mxml, nodeStartAttr, 0);
                customModel.stringStartNodes.set(i, startNode);
                usedTags.add(nodeStartAttr);
            } else if (!m.advanced && mxml.hasAttribute(legacyAttr)) {
                const startNode = getIntAttrDef(mxml, legacyAttr, 0);
                customModel.stringStartNodes.set(i, startNode);
                usedTags.add(legacyAttr);
            }
        }
    }

    // Sphere: versionNumber >= 8 files store scale in the "truly round"
    // coordinate system (upstream fixed sphere scaling: all axes now use
    // radius = max(BufferHt, BufferWi) / (1.8 * 2), where classically X/Z used
    // BufferHt / (1.8 * 1.8 * 2) and Y used BufferHt / (1.8 * 2)).  Our sphere
    // renderer implements the classic semantics the golden layouts were
    // generated with, so convert v8 scales back — the exact inverse of the
    // legacy upgrade in upstream XmlDeserializingModelFactory::DeserializeSphere
    // (which multiplies x,z by (Ht/mx)/1.8 and y by Ht/mx when version < 8).
    if (m instanceof SphereModel) {
        const sm = m as SphereModel;
        const version = parseInt(sm.versionNumber || '0');
        if (!isNaN(version) && version >= 8) {
            const f = sphereV8ScaleFactors(sm.numStrings, sm.pixelsPerString, sm.strandsPerString);
            if (f) {
                sm.scaleX /= f.xz;
                sm.scaleZ /= f.xz;
                sm.scaleY /= f.y;
            }
        }
    }

    // Handle dynamic properties for DMX model (DmxColorWheelColor0-n, DmxColorWheelDMX0-n)
    if (m instanceof DmxModel) {
        const dmxModel = m as DmxModel;

        // Parse DmxColorWheelColor0-n and DmxColorWheelDMX0-n
        for (let i = 0; i <= 255; i++) {
            const colorAttr = `DmxColorWheelColor${i}`;
            const dmxAttr = `DmxColorWheelDMX${i}`;

            if (!mxml.hasAttribute(colorAttr) && !mxml.hasAttribute(dmxAttr) && i > 2) {
                break;
            }

            if (mxml.hasAttribute(colorAttr)) {
                dmxModel.colorWheelColors.set(i, mxml.getAttribute(colorAttr) || '');
                usedTags.add(colorAttr);
            }
            if (mxml.hasAttribute(dmxAttr)) {
                dmxModel.colorWheelDMX.set(i, getIntAttrDef(mxml, dmxAttr, 0));
                usedTags.add(dmxAttr);
            }
        }

        // Parse DmxPresetChannel0-n, DmxPresetValue0-n, DmxPresetDesc0-n
        for (let i = 0; i <= 255; i++) {
            const chAttr = `DmxPresetChannel${i}`;
            const valAttr = `DmxPresetValue${i}`;
            const descAttr = `DmxPresetDesc${i}`;

            if (!mxml.hasAttribute(chAttr) && !mxml.hasAttribute(valAttr) && !mxml.hasAttribute(descAttr) && i > 2) {
                break;
            }

            if (mxml.hasAttribute(chAttr)) usedTags.add(chAttr);
            if (mxml.hasAttribute(valAttr)) usedTags.add(valAttr);
            if (mxml.hasAttribute(descAttr)) usedTags.add(descAttr);
        }

        // Parse moving head definition for DmxMovingHead / DmxMovingHeadAdv / DmxMovingHead3D
        // (xLights converts DmxMovingHead3D → DmxMovingHeadAdv since 2024.5, but older
        // layout files may still have the old DisplayAs value.)
        if (da === 'DmxMovingHeadAdv' || da === 'DmxMovingHead' || da === 'DmxMovingHead3D') {
            dmxModel.mhDefinition = parseMhDefinition(dmxModel, mxml);

            if (da === 'DmxMovingHeadAdv' || da === 'DmxMovingHead3D') {
                // Read controlling mesh dimensions (xLights sets RenderWi/Ht/Dp from the
                // mesh whose set_size=true: HeadMesh > YokeMesh > BaseMesh if each has ObjFile).
                // These are used in beam length scaling: sbl = max(W*scaleX, H*scaleY, D*scaleZ).
                const meshPriority = ['HeadMesh', 'YokeMesh', 'BaseMesh'];
                for (const meshTag of meshPriority) {
                    const meshElem = getOptionalElementByTag(mxml, meshTag);
                    if (meshElem && meshElem.getAttribute('ObjFile')) {
                        dmxModel.meshWidth = getNumAttrDef(meshElem, 'Width', 1);
                        dmxModel.meshHeight = getNumAttrDef(meshElem, 'Height', 1);
                        dmxModel.meshDepth = getNumAttrDef(meshElem, 'Depth', 1);
                        break;
                    }
                }
            }
            // DmxMovingHead uses RenderSize(1,1,1) — meshWidth/Height/Depth stay at default 1.
        }
    }

    const dimming = getOptionalElementByTag(mxml, 'dimmingCurve')
    if (dimming) {
        function getBr(e: Element | undefined) {
            if (!e) return undefined;
            if (!e.hasAttribute('brightness')) return undefined;
            return Math.min(1.0, (100.0+getNumAttrDef(e, 'brightness', 0))/100.0)
        }
        function getGamma(e: Element | undefined) {
            if (!e) return undefined;
            if (!e.hasAttribute('gamma')) return undefined;
            return getNumAttrDef(e, 'gamma', 1);
        }
        const all = getOptionalElementByTag(dimming, 'all');
        const r = getOptionalElementByTag(dimming, 'red');
        const g = getOptionalElementByTag(dimming, 'green');
        const b = getOptionalElementByTag(dimming, 'blue');
        m.dimmingCurve = {
            allBrightness: getBr(all),
            allGamma: getGamma(all),
            rBrightness: getBr(r),
            rGamma: getGamma(r),
            gBrightness: getBr(g),
            gGamma: getGamma(g),
            bBrightness: getBr(b),
            bGamma: getGamma(b),
        }
    }

    // Handle Single Color and Superstring string types - these make each string a single node
    // StringType values like "Single Color Red", "Single Color Blue", "Superstring", etc.
    // Single color / Superstring = dumb string = one channel per string = all lights on string are one node
    const isSingleNodeStringType = m.stringType && (
        m.stringType.startsWith('Single Color') ||
        m.stringType === 'Superstring' ||
        m.stringType.includes('Strobes') ||
        m.stringType.match(/(\d+)\s*Channel/)
    );
    if (isSingleNodeStringType) {
        // Set singleNode if the model has this property
        if ('singleNode' in m) {
            (m as unknown as Record<string, unknown>).singleNode = true;
        }
    }

    // Handle dynamic SuperStringColour<N> properties (SuperStringColour0, SuperStringColour1, etc.)
    // These define per-string colors for multi-string single color models
    for (let i = 0; i <= 32; i++) {
        const colorAttr = `SuperStringColour${i}`;
        if (mxml.hasAttribute(colorAttr)) {
            m.superStringColours.set(i, mxml.getAttribute(colorAttr) || '');
            usedTags.add(colorAttr);
        }
    }

    // Handle individual string start channels (String1, String2, etc.)
    // These are used when Advanced="1" to specify per-string start channels
    // C++ uses StartChanAttrName(idx) = "String" + (idx + 1), so String1, String2, etc.
    if (m.advanced) {
        // Parse String1, String2, ... up to a reasonable maximum
        for (let i = 0; i < 100; i++) {
            const stringAttr = `String${i + 1}`;  // 1-based indexing
            if (mxml.hasAttribute(stringAttr)) {
                m.stringStartChannels.set(i, mxml.getAttribute(stringAttr) || '');
                usedTags.add(stringAttr);
            }
        }
    }

    // Handle ChannelProperties.ChannelColor1-N (per-channel colors for single-color models)
    for (let i = 1; i <= 512; i++) {
        const attr = `ChannelProperties.ChannelColor${i}`;
        if (!mxml.hasAttribute(attr)) {
            if (i > 2) break;
            continue;
        }
        usedTags.add(attr);
    }

    if (options?.warnUnusedAttrs ?? true) {
        const log = options?.logger ?? ((msg: string) => console.log(msg));
        for (let ai = 0; ai<mxml.attributes.length; ++ai) {
            if (!usedTags.has(mxml.attributes[ai].name)) {
                log(`Warning: ${mxml.attributes[ai].name} was defined in XML for ${m.name} but was not used`);
            }
        }
    }

    return m;
}

// Base properties shared by all models.  Legacy encodings (e.g. tree degrees
// embedded in DisplayAs) are normalized away by normalizeModelElementForward
// before these bindings apply.
const baseModelProperties: ModelProperty[] = [
    // Core model stuff
    { name: 'DisplayAs', ptype: "STRING", fieldName: 'displayAs', xmlName: 'DisplayAs', description: "xLights DisplayAs type / etc" },
    { name: 'VersionNumber', ptype: "STRING", fieldName: 'versionNumber', xmlName: 'versionNumber', description: "Model format version number" },
    { name: 'name', ptype: "STRING", fieldName: 'name', xmlName: 'name', description: "xLights model name" },
    { name: 'Description', ptype: "STRING", fieldName: 'description', xmlName: 'Description', description: "Description" },
    { name: 'LayoutGroup', ptype: "STRING", fieldName: 'layoutGroup', xmlName: 'LayoutGroup', description: "Layout Group" },
    { name: 'Locked', ptype: "BOOL", fieldName: 'locked', xmlName: 'Locked', description: "Locked" },
    { name: 'Active', ptype: "BOOL", fieldName: 'active', xmlName: 'Active', description: "Active" },
    { name: 'FromBase', ptype: "BOOL", fieldName: 'fromBase', xmlName: 'FromBase', description: 'FromBase'},

    // TODO:
    //  Shadow model
    //  Strand / node names
    //  Dimming curves
    //  Faces, submodels, states
    //  Aliases
    // Controller
    //   There is also a controller connection subnode, and smart remote, and null pixels, and brightness / gamma / direction
    { name: 'StartChannel', ptype: "STRING", fieldName: 'startChannel', xmlName: 'StartChannel', description: "xLights start channel" },
    { name: 'Controller', ptype: "STRING", fieldName: 'controller', xmlName: 'Controller', description: "Controller name" },

    // String physical technology used
    { name: 'StringType', ptype: "STRING", fieldName: 'stringType', xmlName: 'StringType', description: "xLights StringType eg RGB Nodes" },
    // RGBW handling
    { name: 'RGBWHandling', ptype: "STRING", fieldName: 'rgbwHandling', xmlName: 'RGBWHandling', description: "RGBW handling mode" },

    // Appearance: Preview display properties
    { name: 'Antialias', ptype: "INTEGER", fieldName: 'antialias', xmlName: 'Antialias', description: "Antialias display" },
    { name: 'PixelSize', ptype: "INTEGER", fieldName: 'pixelSize', xmlName: 'PixelSize', description: "Pixel size in display" },
    { name: 'Transparency', ptype: "INTEGER", fieldName: 'transparency', xmlName: 'Transparency', description: "Transparency in display" },
    { name: 'BlackTransparency', ptype: "INTEGER", fieldName: 'blackTransparency', xmlName: 'BlackTransparency', description: "Black transparency" },
    { name: 'LowDefinition', ptype: "INTEGER", fieldName: 'lowDefinition', xmlName: 'LowDefinition', description: "Low definition render factor" },
    { name: 'Advanced', ptype: "BOOL", fieldName: 'advanced', xmlName: 'Advanced', description: "Individual string start channels" },

    // Size / location
    { name: 'WorldPosX', ptype: "FLOAT", fieldName: 'worldPosX', xmlName: 'WorldPosX', description: "World X" },
    { name: 'WorldPosY', ptype: "FLOAT", fieldName: 'worldPosY', xmlName: 'WorldPosY', description: "World Y" },
    { name: 'WorldPosZ', ptype: "FLOAT", fieldName: 'worldPosZ', xmlName: 'WorldPosZ', description: "World Z" },

    { name: 'X2', ptype: "FLOAT", fieldName: 'x2', xmlName: 'X2', description: "Relative X2" },
    { name: 'Y2', ptype: "FLOAT", fieldName: 'y2', xmlName: 'Y2', description: "Relative Y2" },
    { name: 'Z2', ptype: "FLOAT", fieldName: 'z2', xmlName: 'Z2', description: "Relative Z2" },

    { name: 'RotateX', ptype: "FLOAT", fieldName: 'rotateX', xmlName: 'RotateX', description: "Rotate on X" },
    { name: 'RotateY', ptype: "FLOAT", fieldName: 'rotateY', xmlName: 'RotateY', description: "Rotate on Y" },
    { name: 'RotateZ', ptype: "FLOAT", fieldName: 'rotateZ', xmlName: 'RotateZ', description: "Rotate on Z" },
    { name: 'ScaleX', ptype: "FLOAT", fieldName: 'scaleX', xmlName: 'ScaleX', description: "Scale X" },
    { name: 'ScaleY', ptype: "FLOAT", fieldName: 'scaleY', xmlName: 'ScaleY', description: "Scale Y" },
    { name: 'ScaleZ', ptype: "FLOAT", fieldName: 'scaleZ', xmlName: 'ScaleZ', description: "Scale Z" },

    // Common model properties
    { name: 'Dir', ptype: "STRING", fieldName: 'dir', xmlName: 'Dir', description: "Direction L/R" },
    { name: 'StartSide', ptype: "STRING", fieldName: 'startSide', xmlName: 'StartSide', description: "Start Side T/B" },
    { name: 'ModelBrightness', ptype: "INTEGER", fieldName: 'modelBrightness', xmlName: 'ModelBrightness', description: "Model brightness" },
    { name: 'StrandNames', ptype: "STRING", fieldName: 'strandNames', xmlName: 'StrandNames', description: "Strand names" },
    { name: 'NodeNames', ptype: "STRING", fieldName: 'nodeNames', xmlName: 'NodeNames', description: "Node names" },

    // Controller/pixel properties
    { name: 'PixelCount', ptype: "STRING", fieldName: 'pixelCount', xmlName: 'PixelCount', description: "Pixel count" },
    { name: 'PixelType', ptype: "STRING", fieldName: 'pixelType', xmlName: 'PixelType', description: "Pixel type" },
    { name: 'PixelSpacing', ptype: "STRING", fieldName: 'pixelSpacing', xmlName: 'PixelSpacing', description: "Pixel spacing" },

    // Color properties
    { name: 'CustomColor', ptype: "STRING", fieldName: 'customColor', xmlName: 'CustomColor', description: "Custom color" },
    { name: 'TagColour', ptype: "STRING", fieldName: 'tagColour', xmlName: 'TagColour', description: "Model tag color" },

    { name: 'CustomBkgLightness', ptype: "FLOAT", fieldName: 'customBkgLightness', xmlName: 'CustomBkgLightness', description: "CustomBkgLightness" },
    { name: 'CustomBkgImage', ptype: "STRING", fieldName: 'customBkgImage', xmlName: 'CustomBkgImage', description: "CustomBkgImage" },
    { name: 'ModelChain', ptype: "STRING", fieldName: 'modelChain', xmlName: 'ModelChain', description: "ModelChain" },
    { name: 'ShadowModelFor', ptype: "STRING", fieldName: 'shadowModelFor', xmlName: 'ShadowModelFor', description: "ShadowModelFor" },

    // Legacy preview placement properties (pre-World coordinate system)
    { name: 'offsetXpct', ptype: "FLOAT", fieldName: 'offsetXpct', xmlName: 'offsetXpct', description: "Legacy preview X offset %" },
    { name: 'offsetYpct', ptype: "FLOAT", fieldName: 'offsetYpct', xmlName: 'offsetYpct', description: "Legacy preview Y offset %" },
    { name: 'PreviewScaleX', ptype: "FLOAT", fieldName: 'previewScaleX', xmlName: 'PreviewScaleX', description: "Legacy preview scale X" },
    { name: 'PreviewScaleY', ptype: "FLOAT", fieldName: 'previewScaleY', xmlName: 'PreviewScaleY', description: "Legacy preview scale Y" },
    { name: 'PreviewRotation', ptype: "FLOAT", fieldName: 'previewRotation', xmlName: 'PreviewRotation', description: "Legacy preview rotation" },
];
