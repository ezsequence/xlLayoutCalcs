import { getIntAttrDef, getOptionalElementByTag } from './utils';

/**
 * Whole-layout preview settings from the `<settings>` section of
 * `xlights_rgbeffects.xml`.
 *
 * Each `<settings>` child element carries its value in a `value="..."`
 * attribute (e.g. `<previewWidth value="1280"/>`). The fields most relevant
 * to layout/preview consumers are surfaced as typed properties; every
 * setting in the section (including those, plus directories, editor UI
 * toggles, ...) is additionally available verbatim in `raw`.
 *
 * All typed fields are optional and `undefined` when the corresponding
 * setting is absent or empty — xLights' own fallback defaults (noted per
 * field) are the caller's to apply. `backgroundImage` is the raw stored
 * path — resolving it against the show folder is the caller's job.
 */
export interface LayoutSettingsInfo {
    /** Default-preview background image path exactly as stored in the XML. */
    backgroundImage?: string;
    /** Background image brightness, 0–100. xLights default: 100. */
    backgroundBrightness?: number;
    /** Background image alpha, 0–100. xLights default: 100. */
    backgroundAlpha?: number;
    /**
     * Whether the default-preview background image is stretched to fill the
     * preview (`true`) or drawn at its natural aspect (`false`).
     * xLights default: false.
     */
    scaleImage?: boolean;
    /** Default preview width in pixels. */
    previewWidth?: number;
    /** Default preview height in pixels. */
    previewHeight?: number;
    /**
     * Layout editing mode last saved by xLights: `true` = 3D, `false` = 2D,
     * `undefined` = unspecified (file predates the `<LayoutMode3D>` setting).
     * xLights treats a stored value of "1" as 3D and anything else as 2D.
     */
    layoutMode3D?: boolean;
    /**
     * Name of the layout group last selected in the Layout tab ("Default",
     * "All Models", "Unassigned", or a user-defined group name).
     * xLights default: "Default".
     */
    storedLayoutGroup?: string;
    /** xLights version that last saved the file, e.g. "2026.04". */
    xlightsVersion?: string;
    /**
     * Every `<settings>` child's value string verbatim, keyed by element
     * name (names are case-sensitive, e.g. "LayoutMode3D", "fseqDir",
     * "Display2DGridSpacing"). A child without a `value` attribute maps to
     * "", matching how xLights reads the section. Empty when `<settings>`
     * is absent.
     */
    raw: Record<string, string>;
}

function readSettingValue(settings: Element, tag: string): string | undefined {
    const el = getOptionalElementByTag(settings, tag);
    if (!el) return undefined;
    const v = el.getAttribute('value');
    return v == null || v === '' ? undefined : v;
}

// xLights semantics for LayoutMode3D and Display2D* flags: "1" is true, any
// other non-empty value is false.
function readSettingBool(settings: Element, tag: string): boolean | undefined {
    const v = readSettingValue(settings, tag);
    return v === undefined ? undefined : v === '1';
}

// xLights semantics for scaleImage: strtol(value) > 0.
function readSettingIntBool(settings: Element, tag: string): boolean | undefined {
    const v = readSettingInt(settings, tag);
    return v === undefined ? undefined : v > 0;
}

function readSettingInt(settings: Element, tag: string): number | undefined {
    const el = getOptionalElementByTag(settings, tag);
    if (!el) return undefined;
    const v = getIntAttrDef(el, 'value', Number.NaN);
    return Number.isNaN(v) ? undefined : v;
}

/**
 * Parse the `<settings>` section of an xLights `xlights_rgbeffects.xml`.
 *
 * Accepts BOTH the x2026_2 and x2026_3 rgbeffects formats — the section is
 * format-identical for the fields surfaced here. Returns an object with an
 * empty `raw` map when the `<settings>` element is absent.
 */
export function getLayoutSettings(rgbeffectsDoc: Document): LayoutSettingsInfo {
    const root = rgbeffectsDoc.documentElement;
    const settings = root ? getOptionalElementByTag(root, 'settings') : undefined;
    if (!settings) return { raw: {} };

    const raw: Record<string, string> = {};
    for (let n = settings.firstChild; n; n = n.nextSibling) {
        if (n.nodeType !== 1 /* ELEMENT_NODE */) continue;
        const el = n as Element;
        raw[el.tagName] = el.getAttribute('value') ?? '';
    }

    return {
        backgroundImage: readSettingValue(settings, 'backgroundImage'),
        backgroundBrightness: readSettingInt(settings, 'backgroundBrightness'),
        backgroundAlpha: readSettingInt(settings, 'backgroundAlpha'),
        scaleImage: readSettingIntBool(settings, 'scaleImage'),
        previewWidth: readSettingInt(settings, 'previewWidth'),
        previewHeight: readSettingInt(settings, 'previewHeight'),
        layoutMode3D: readSettingBool(settings, 'LayoutMode3D'),
        storedLayoutGroup: readSettingValue(settings, 'storedLayoutGroup'),
        xlightsVersion: readSettingValue(settings, 'xlightsVersion'),
        raw,
    };
}
