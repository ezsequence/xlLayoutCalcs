import {
    getAttrDef,
    getBoolAttrDef,
    getChildElementsByTag,
    getNumAttrDef,
    getOptionalElementByTag,
    XMLConstants,
} from './utils';
import type { ModelParseOptions } from './models';
import { parseModelsAndResolveChannels } from './modelinterface';

/** xLights controller enable state (`ActiveState` attribute). */
export type XlControllerActiveState = 'Active' | 'Inactive' | 'xLights Only' | 'Unknown';
/** xLights controller transport kind (`Type` attribute). */
export type XlControllerType = 'Null' | 'Ethernet' | 'Serial' | 'Unknown';

/**
 * One `<Controller>` from `xlights_networks.xml`.
 *
 * The networks schema is identical across the x2026_2 and x2026_3 layout
 * formats, so no migration/normalization is needed.
 *
 * Channel bookkeeping matches xLights' cumulative layout: the first
 * controller starts at (1-based) channel 1 and each subsequent controller
 * starts immediately after the previous one's `maxChannels`.
 */
export interface XlControllerInfo {
    /** `Id` attribute (kept as string; not guaranteed unique in real files). */
    id: string;
    name: string;
    /** IP address or serial port (`IP` attribute); '' when absent. */
    address: string;
    description: string;
    activeState: XlControllerActiveState;
    type: XlControllerType;
    /** `Monitor` attribute; defaults to true when absent. */
    monitor: boolean;

    vendor: string;
    model: string;
    variant: string;
    /** Output protocol (e.g. 'E131', 'DDP'); '' when absent. */
    protocol: string;

    /** Absolute 1-based first channel of this controller in the frame layout. */
    startChannel: number;
    /** Total channels: sum of the `<network>` children's MaxChannels (default 510 each). */
    maxChannels: number;

    /**
     * Universe number of each `<network>` child, in document order.
     * xLights historically stores the E1.31 universe number in the
     * `BaudRate` attribute (default 1); for DDP these are start-channel-ish
     * values rather than true universes.
     */
    universeNumbers: number[];
    /** MaxChannels of each `<network>` child, parallel to `universeNumbers`. */
    universeSizes: number[];
    /**
     * `ChannelsPerPacket` (DDP option) — the LAST `<network>` child's value
     * wins, default 1440. (Matches the historical EZPlayer reader; xLights
     * writes the same value on every network of a controller.)
     */
    channelsPerPacket: number;
    /**
     * `KeepChannelNumbers` (DDP option) — the LAST `<network>` child's value
     * wins, default false. (Same last-network-wins note as above.)
     */
    keepChannelNumbers: boolean;
}

/**
 * Channel/color info for one `<model>` from the rgbeffects `<models>` section.
 * Everything a player needs to map frame bytes onto a model without doing
 * geometry: absolute channel range plus color-order/dimming interpretation.
 */
export interface XlModelChannelInfo {
    name: string;
    /** Raw `DisplayAs` attribute value, NOT normalized (e.g. "Tree 360" in x2026_2 files). */
    displayAs: string;
    /** Resolved absolute 1-based first channel of this model. */
    startChannel: number;
    /**
     * Exact channel count derived from the parsed model geometry
     * (totalNodes × channelsPerNode), NOT inferred from neighboring models.
     */
    channelCount: number;

    /**
     * Byte offsets of the red/green/blue channels within each node, derived
     * from `StringType` ("RGB Nodes" → {0,1,2}, "GRB Nodes" → {1,0,2}, ...).
     * Defaults to {0,1,2} for non-RGB-order string types.
     */
    rgbOffsets: { r: number; g: number; b: number };
    /** True when StringType is one of the six plain 3-color node orders. */
    simple: boolean;

    /** Gamma from `<dimmingCurve><all gamma="..."/>`; default 1. */
    gamma: number;
    /**
     * Brightness factor from `<dimmingCurve><all brightness="..."/>`,
     * computed as min(1, (100 + value) / 100); default 1.
     */
    brightness: number;
}

export interface ControllersAndModelChannels {
    controllers: XlControllerInfo[];
    models: XlModelChannelInfo[];
}

// StringType → RGB byte offsets for the six plain color orders.
// Everything else keeps the {0,1,2} default with simple=false.
const RGB_ORDER_OFFSETS: Record<string, { r: number; g: number; b: number }> = {
    'RGB Nodes': { r: 0, g: 1, b: 2 },
    'RBG Nodes': { r: 0, g: 2, b: 1 },
    'GRB Nodes': { r: 1, g: 0, b: 2 },
    'GBR Nodes': { r: 2, g: 0, b: 1 },
    'BRG Nodes': { r: 1, g: 2, b: 0 },
    'BGR Nodes': { r: 2, g: 1, b: 0 },
};

function parseControllers(networksDoc: Document): XlControllerInfo[] {
    const controllers: XlControllerInfo[] = [];
    const root = networksDoc.documentElement;
    if (!root) return controllers;

    let startChannel = 1; // 1-based cumulative across controllers

    for (const cn of getChildElementsByTag(root, 'Controller')) {
        const rawState = cn.getAttribute('ActiveState');
        const activeState: XlControllerActiveState =
            rawState === 'Active' || rawState === 'Inactive' || rawState === 'xLights Only'
                ? rawState : 'Unknown';
        const rawType = cn.getAttribute('Type');
        const type: XlControllerType =
            rawType === 'Null' || rawType === 'Ethernet' || rawType === 'Serial'
                ? rawType : 'Unknown';

        const universeNumbers: number[] = [];
        const universeSizes: number[] = [];
        let maxChannels = 0;
        let channelsPerPacket = 1440;
        let keepChannelNumbers = false;

        for (const net of getChildElementsByTag(cn, 'network')) {
            const size = getNumAttrDef(net, 'MaxChannels', 510);
            // xLights stores the E1.31 universe number in 'BaudRate'.
            universeNumbers.push(getNumAttrDef(net, 'BaudRate', 1));
            universeSizes.push(size);
            maxChannels += size;
            // Deliberately last-network-wins (see interface docs).
            channelsPerPacket = getNumAttrDef(net, 'ChannelsPerPacket', 1440);
            keepChannelNumbers = getBoolAttrDef(net, 'KeepChannelNumbers', false);
        }

        controllers.push({
            id: getAttrDef(cn, 'Id', ''),
            name: getAttrDef(cn, 'Name', ''),
            address: getAttrDef(cn, 'IP', ''),
            description: getAttrDef(cn, 'Description', ''),
            activeState,
            type,
            monitor: getBoolAttrDef(cn, 'Monitor', true),
            vendor: getAttrDef(cn, 'Vendor', ''),
            model: getAttrDef(cn, 'Model', ''),
            variant: getAttrDef(cn, 'Variant', ''),
            protocol: getAttrDef(cn, 'Protocol', ''),
            startChannel,
            maxChannels,
            universeNumbers,
            universeSizes,
            channelsPerPacket,
            keepChannelNumbers,
        });

        startChannel += maxChannels;
    }

    return controllers;
}

function parseDimmingCurve(mdl: Element): { gamma: number; brightness: number } {
    let gamma = 1;
    let brightness = 1;
    for (const dc of getChildElementsByTag(mdl, 'dimmingCurve')) {
        for (let i = 0; i < dc.childNodes.length; ++i) {
            const n = dc.childNodes[i];
            if (n.nodeType !== XMLConstants.ELEMENT_NODE) continue;
            const all = n as Element;
            if (all.tagName !== 'all') continue;
            if (all.hasAttribute('gamma')) {
                gamma = Number.parseFloat(all.getAttribute('gamma')!);
            }
            if (all.hasAttribute('brightness')) {
                brightness = Math.min(1.0, (100.0 + Number.parseFloat(all.getAttribute('brightness')!)) / 100.0);
            }
        }
    }
    return { gamma, brightness };
}

/**
 * Parse controllers (from `xlights_networks.xml`) and per-model channel/color
 * info (from `xlights_rgbeffects.xml`) — the data a player needs to map fseq
 * frame bytes onto controllers and models.
 *
 * Accepts BOTH the x2026_2 and x2026_3 rgbeffects formats without
 * pre-migration (model channel resolution normalizes per model element; the
 * networks schema is identical across formats).
 *
 * Start channels are resolved with the same machinery that powers
 * `getAllModelCoordinates` — direct numbers, `!Controller:ch`,
 * `#universe:ch` / `#ip:universe:ch`, and `>Model:ch` / `@Model:ch`
 * dependency forms all resolve to absolute channels. Models are skipped when:
 *  - they have no usable `name` or no `StartChannel` attribute at all
 *    (inactive/degenerate entries; skipped silently), or
 *  - their geometry fails to parse (unknown DisplayAs, ...), or their start
 *    channel can't be resolved (e.g. a `>Shadow` reference to a missing
 *    model) — both reported through `options.logger`.
 */
export function getControllersAndModelChannels(
    rgbeffectsDoc: Document,
    networksDoc: Document,
    options?: ModelParseOptions,
): ControllersAndModelChannels {
    const controllers = parseControllers(networksDoc);

    const { modelObjs, resolvedChannels } =
        parseModelsAndResolveChannels(rgbeffectsDoc, networksDoc, options);
    const parsedNames = new Set(modelObjs.map(m => m.name));
    const log = options?.logger ?? ((msg: string) => console.warn(msg));

    const models: XlModelChannelInfo[] = [];
    const root = rgbeffectsDoc.documentElement;
    const modelsNode = root ? getOptionalElementByTag(root, 'models') : undefined;
    if (modelsNode) {
        for (const mdl of getChildElementsByTag(modelsNode, 'model')) {
            const name = getAttrDef(mdl, 'name', '');
            const chstr = getAttrDef(mdl, 'StartChannel', '');
            if (!name || !chstr) {
                // Some sort of inactive, degenerate entry — skip silently.
                continue;
            }

            const resolved = resolvedChannels.get(name);
            if (!resolved) {
                // Geometry-parse failures were already warned about inside
                // parseModelsAndResolveChannels; only warn here for models
                // that parsed but whose channels couldn't be resolved.
                if (parsedNames.has(name)) {
                    log(`Warning: skipping model "${name}": channels not resolved`);
                }
                continue;
            }

            const stringType = getAttrDef(mdl, 'StringType', '');
            const rgbOffsets = RGB_ORDER_OFFSETS[stringType];
            const { gamma, brightness } = parseDimmingCurve(mdl);

            models.push({
                name,
                displayAs: getAttrDef(mdl, 'DisplayAs', ''),
                // channelMapping is 0-based internally; surface 1-based.
                startChannel: resolved.channelMapping.firstChannel + 1,
                channelCount: resolved.channelMapping.totalChannels,
                rgbOffsets: rgbOffsets ? { ...rgbOffsets } : { r: 0, g: 1, b: 2 },
                simple: !!rgbOffsets,
                gamma,
                brightness,
            });
        }
    }

    return { controllers, models };
}
