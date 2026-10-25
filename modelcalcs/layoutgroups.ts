import { getChildElementsByTag, getOptionalElementByTag } from './utils';

/**
 * Metadata for a single xLights preview / layout group, as declared in
 * `<layoutGroups><layoutGroup .../></layoutGroups>` inside `xlights_rgbeffects.xml`.
 *
 * Model membership is NOT stored here — each model carries its own
 * `LayoutGroup` attribute, surfaced via `GetNodeResult.layoutGroup` on the
 * results of `getAllModelCoordinates`. Iterate those results to discover
 * which models belong to a group.
 */
export interface LayoutGroupInfo {
    /** Group name (e.g. "Default", "House", "Front Yard"). */
    name: string;
    /** Background image path exactly as stored in the XML (may be relative — caller resolves). */
    backgroundImage?: string;
    /** Preview pane X position in the xLights UI. */
    posX?: number;
    /** Preview pane Y position in the xLights UI. */
    posY?: number;
    /** Preview pane width in pixels. */
    paneWidth?: number;
    /** Preview pane height in pixels. */
    paneHeight?: number;
    /** Background image brightness, 0–100. */
    backgroundBrightness?: number;
    /** Background image alpha, 0–100. */
    backgroundAlpha?: number;
    /** xLights "Fill": stretch the background to the pane. Absent means false (xLights default). */
    scaleImage?: boolean;
}

function readAttr(el: Element, ...names: string[]): string {
    for (const n of names) {
        const v = el.getAttribute(n);
        if (v != null && v !== '') return v;
    }
    return '';
}

// xLights semantics for scaleImage: wxAtoi(value) > 0.
function readIntBoolAttr(el: Element, ...names: string[]): boolean | undefined {
    const num = readNumAttr(el, ...names);
    return num === undefined ? undefined : Math.trunc(num) > 0;
}

function readNumAttr(el: Element, ...names: string[]): number | undefined {
    for (const n of names) {
        const v = el.getAttribute(n);
        if (v == null || v === '') continue;
        const num = Number.parseFloat(v);
        if (Number.isFinite(num)) return num;
    }
    return undefined;
}

/**
 * Like readNumAttr, but treats xLights' -1 "unset" sentinel as absent.
 * xLights writes PosX/PosY/PaneWidth/PaneHeight="-1" for layout groups whose
 * preview pane has never been sized (and forward migration adds the same
 * sentinel), so -1 must not reach callers as a real dimension.
 */
function readPaneAttr(el: Element, ...names: string[]): number | undefined {
    const num = readNumAttr(el, ...names);
    return num === -1 ? undefined : num;
}

/**
 * Parse the `<layoutGroups>` section of an xLights `xlights_rgbeffects.xml`.
 *
 * Returns one `LayoutGroupInfo` per `<layoutGroup>` child, in document order.
 * Groups without a usable `name` attribute are skipped. Returns `[]` when the
 * `<layoutGroups>` element is absent.
 *
 * Attribute names are matched with a small set of case variants (`PosX`/`posX`,
 * `backgroundBrightness`/`BackgroundBrightness`, …) to tolerate the casing
 * differences seen across xLights forks and versions.
 */
export function getAllLayoutGroups(rgbeffectsDoc: Document): LayoutGroupInfo[] {
    const root = rgbeffectsDoc.documentElement;
    if (!root) return [];

    const container = getOptionalElementByTag(root, 'layoutGroups');
    if (!container) return [];

    const groups: LayoutGroupInfo[] = [];
    const elements = getChildElementsByTag(container, 'layoutGroup');
    for (const el of elements) {
        const name = readAttr(el, 'name', 'Name').trim();
        if (!name) continue;

        const backgroundImage = readAttr(el, 'backgroundImage', 'BackgroundImage').trim();

        groups.push({
            name,
            backgroundImage: backgroundImage || undefined,
            posX: readPaneAttr(el, 'PosX', 'posX'),
            posY: readPaneAttr(el, 'PosY', 'posY'),
            paneWidth: readPaneAttr(el, 'PaneWidth', 'paneWidth'),
            paneHeight: readPaneAttr(el, 'PaneHeight', 'paneHeight'),
            backgroundBrightness: readNumAttr(el, 'backgroundBrightness', 'BackgroundBrightness'),
            backgroundAlpha: readNumAttr(el, 'backgroundAlpha', 'BackgroundAlpha'),
            scaleImage: readIntBoolAttr(el, 'scaleImage', 'ScaleImage'),
        });
    }

    return groups;
}
