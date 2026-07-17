import { getIntAttrDef, getOptionalElementByTag } from './utils';

/**
 * Whole-layout preview settings from the `<settings>` section of
 * `xlights_rgbeffects.xml`.
 *
 * Each `<settings>` child element carries its value in a `value="..."`
 * attribute (e.g. `<previewWidth value="1280"/>`). Only the fields relevant
 * to layout/preview consumers are surfaced; everything else in the section
 * (backup dirs, UI toggles, ...) is ignored.
 *
 * All fields are optional and `undefined` when the corresponding setting is
 * absent. `backgroundImage` is the raw stored path — resolving it against
 * the show folder is the caller's job.
 */
export interface LayoutSettingsInfo {
    /** Default-preview background image path exactly as stored in the XML. */
    backgroundImage?: string;
    /** Background image brightness, 0–100. */
    backgroundBrightness?: number;
    /** Default preview width in pixels. */
    previewWidth?: number;
    /** Default preview height in pixels. */
    previewHeight?: number;
}

function readSettingValue(settings: Element, tag: string): string | undefined {
    const el = getOptionalElementByTag(settings, tag);
    if (!el) return undefined;
    const v = el.getAttribute('value');
    return v == null || v === '' ? undefined : v;
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
 * format-identical for the fields surfaced here. Returns an empty object
 * when the `<settings>` element is absent.
 */
export function getLayoutSettings(rgbeffectsDoc: Document): LayoutSettingsInfo {
    const root = rgbeffectsDoc.documentElement;
    if (!root) return {};

    const settings = getOptionalElementByTag(root, 'settings');
    if (!settings) return {};

    return {
        backgroundImage: readSettingValue(settings, 'backgroundImage'),
        backgroundBrightness: readSettingInt(settings, 'backgroundBrightness'),
        previewWidth: readSettingInt(settings, 'previewWidth'),
        previewHeight: readSettingInt(settings, 'previewHeight'),
    };
}
