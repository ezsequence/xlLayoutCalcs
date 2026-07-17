import { getOptionalElementByTag, XMLConstants } from './utils';

/**
 * A saved camera pose from the `<Viewpoints>` section of `xlights_rgbeffects.xml`.
 *
 * xLights stores three kinds of entries under `<Viewpoints>`:
 *   • `<Camera name="..."/>`         — user-named saved viewpoints
 *   • `<DefaultCamera2D name="..."/>` — the default pose used in 2D mode
 *   • `<DefaultCamera3D name="..."/>` — the default pose used in 3D mode
 *
 * The `kind` field discriminates between them. User-defined viewpoints are
 * returned in document order under `ViewpointsResult.viewpoints`; the two
 * defaults (if present) are surfaced separately.
 */
export interface ViewpointInfo {
    kind: 'camera' | 'default2d' | 'default3d';
    name: string;
    /** True when saved from the 3D view (xLights `is_3d="1"`). */
    is3D: boolean;

    posX: number;
    posY: number;
    posZ: number;

    /** Rotation in degrees around each axis, matching xLights convention. */
    angleX: number;
    angleY: number;
    angleZ: number;

    /** Camera distance. Typically negative in xLights (camera looks along +Z toward the origin). */
    distance: number;
    /** Zoom factor; 1.0 = unity. Defaults to 1 when absent. */
    zoom: number;

    panX: number;
    panY: number;
    panZ: number;

    /** xLights-internal zoom-correction offsets; carry through as-is for faithful restore. */
    zoomCorrX: number;
    zoomCorrY: number;
}

export interface ViewpointsResult {
    /** User-defined `<Camera>` entries, in document order. Excludes the two defaults. */
    viewpoints: ViewpointInfo[];
    /** The `<DefaultCamera2D>` entry, if present. */
    default2D?: ViewpointInfo;
    /** The `<DefaultCamera3D>` entry, if present. */
    default3D?: ViewpointInfo;
}

const VIEWPOINTS_TAG = 'Viewpoints';
const CAMERA_TAG = 'Camera';
const DEFAULT_2D_TAG = 'DefaultCamera2D';
const DEFAULT_3D_TAG = 'DefaultCamera3D';

function readNum(el: Element, name: string, def = 0): number {
    const v = el.getAttribute(name);
    if (v == null || v === '') return def;
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : def;
}

function parseCamera(el: Element, kind: ViewpointInfo['kind']): ViewpointInfo | null {
    const name = (el.getAttribute('name') ?? '').trim();
    if (!name) return null;
    return {
        kind,
        name,
        is3D: el.getAttribute('is_3d') === '1',
        posX: readNum(el, 'posX'),
        posY: readNum(el, 'posY'),
        posZ: readNum(el, 'posZ'),
        angleX: readNum(el, 'angleX'),
        angleY: readNum(el, 'angleY'),
        angleZ: readNum(el, 'angleZ'),
        distance: readNum(el, 'distance'),
        zoom: readNum(el, 'zoom', 1),
        panX: readNum(el, 'panx'),
        panY: readNum(el, 'pany'),
        panZ: readNum(el, 'panz'),
        zoomCorrX: readNum(el, 'zoom_corrx'),
        zoomCorrY: readNum(el, 'zoom_corry'),
    };
}

/**
 * Parse the `<Viewpoints>` section of an xLights `xlights_rgbeffects.xml`.
 *
 * Returns `{ viewpoints: [] }` when the `<Viewpoints>` element is absent.
 * `<Camera>` entries without a usable `name` attribute are skipped. If
 * multiple `<DefaultCamera2D>` / `<DefaultCamera3D>` elements appear
 * (should not happen in valid XML), the last well-formed one wins.
 */
export function getAllViewpoints(rgbeffectsDoc: Document): ViewpointsResult {
    const root = rgbeffectsDoc.documentElement;
    if (!root) return { viewpoints: [] };

    const container = getOptionalElementByTag(root, VIEWPOINTS_TAG);
    if (!container) return { viewpoints: [] };

    const viewpoints: ViewpointInfo[] = [];
    let default2D: ViewpointInfo | undefined;
    let default3D: ViewpointInfo | undefined;

    for (let i = 0; i < container.childNodes.length; i++) {
        const node = container.childNodes[i];
        if (node.nodeType !== XMLConstants.ELEMENT_NODE) continue;
        const el = node as Element;
        switch (el.tagName) {
            case CAMERA_TAG: {
                const vp = parseCamera(el, 'camera');
                if (vp) viewpoints.push(vp);
                break;
            }
            case DEFAULT_2D_TAG: {
                const vp = parseCamera(el, 'default2d');
                if (vp) default2D = vp;
                break;
            }
            case DEFAULT_3D_TAG: {
                const vp = parseCamera(el, 'default3d');
                if (vp) default3D = vp;
                break;
            }
        }
    }

    return { viewpoints, default2D, default3D };
}
