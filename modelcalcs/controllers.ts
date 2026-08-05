import {
    getAttrDef,
    getBoolAttrDef,
    getChildElementsByTag,
    getNumAttrDef,
    getOptionalElementByTag,
    XMLConstants,
} from './utils';
import type { ModelParseOptions } from './models';
import type { ModelChannelMapping } from './modelbase';
import type { BaseModelClass } from './modelshared';
import { parseModelsAndResolveChannels } from './modelinterface';

// ---------------------------------------------------------------------------
// Optional-attribute helpers: set-vs-unset semantics.
//
// Unlike the getXxxAttrDef helpers (which default-fill), these return
// undefined when the attribute is absent OR empty — xLights often writes
// empty strings for "not set" (FPPProxy="", BaseShowDir="") and never
// writes ControllerConnection attributes that aren't set at all.  The
// distinction matters downstream: absent means "xLights did not set this",
// never a synthesized default.
// ---------------------------------------------------------------------------

function optAttr(el: Element, name: string): string | undefined {
    const v = el.getAttribute(name);
    return v === null || v === '' ? undefined : v;
}

function optIntAttr(el: Element, name: string): number | undefined {
    const v = optAttr(el, name);
    if (v === undefined) return undefined;
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? undefined : n;
}

function optFloatAttr(el: Element, name: string): number | undefined {
    const v = optAttr(el, name);
    if (v === undefined) return undefined;
    const n = Number.parseFloat(v);
    return Number.isNaN(n) ? undefined : n;
}

/** "1"/"true"/"TRUE" → true; any other present value → false; absent → undefined. */
function optBoolAttr(el: Element, name: string): boolean | undefined {
    const v = optAttr(el, name);
    if (v === undefined) return undefined;
    const c = v[0];
    return c === '1' || c === 'T' || c === 't';
}

/** xLights controller enable state (`ActiveState` attribute). */
export type XlControllerActiveState = 'Active' | 'Inactive' | 'xLights Only' | 'Unknown';
/** xLights controller transport kind (`Type` attribute). */
export type XlControllerType = 'Null' | 'Ethernet' | 'Serial' | 'Unknown';

/** xLights network/output protocol on a `<Controller>`. Open union: the common
 *  values autocomplete, but any string still parses (this is ingestion — we
 *  capture whatever the file wrote). */
export type XlNetworkProtocol =
    | 'E131' | 'ArtNet' | 'DDP' | 'DMX' | 'ZCPP' | 'LOR' | 'Renard'
    | (string & {});

/** xLights pixel protocol on a model's `<ControllerConnection>`. Open union —
 *  known values autocomplete; any string still parses (xLights' list is large
 *  and grows across releases). */
export type XlPixelProtocol =
    | 'ws2811' | 'ws2801' | 'ws2812' | 'ws2813' | 'tls3001'
    | 'tm1814' | 'tm1829' | 'apa102' | 'apa109' | 'sk6812'
    | 'ucs8903' | 'ucs8904' | 'gs8208' | 'lpd6803' | 'lpd8806'
    | 'sm16716' | 'mbi6020' | 'my9231' | 'my9291'
    | 'dmx' | 'pixelnet' | 'renard' | 'lor'
    | (string & {});

/**
 * One `<network>` child of a `<Controller>` — a single output.
 *
 * All optional fields follow set-vs-unset semantics: absent means the
 * attribute was not written (or was empty) in the XML.
 */
export interface XlControllerOutput {
    /** `NetworkType` attr (e.g. 'E131', 'DDP', 'ArtNet', 'DMX'). */
    networkType?: string;
    /** `ComPort` attr — per-network IP for IP outputs, COM port for serial. */
    comPort?: string;
    /**
     * Universe number: explicit `Universe` attr when present (synthetic
     * files), else the `BaudRate` attr real xLights writes (upstream
     * IPOutput serializes the universe into BaudRate).  For DDP these are
     * start-channel-ish values rather than true universes.
     */
    universe?: number;
    /** `UniverseCount` attr — old-style multi-universe rows; modern xLights
     *  writes one `<network>` per universe so this is normally absent. */
    universeCount?: number;
    /** `MaxChannels` attr; default 510 (matching the controller-level sum). */
    maxChannels: number;
    /** `ChannelsPerPacket` attr (DDP option). */
    channelsPerPacket?: number;
    /** `KeepChannelNumbers` attr (DDP option). */
    keepChannelNumbers?: boolean;
    /** `BaudRate` attr as an actual baud rate — only on Serial controllers,
     *  where xLights reuses the attribute the ethernet outputs use for the
     *  universe number. */
    baudRate?: number;
    /**
     * Computed absolute 1-based first channel of this output in the frame
     * layout (the first output of a controller starts at the controller's
     * own startChannel).  Accumulates `maxChannels` per `<network>` element
     * in document order — consistent with `XlControllerInfo.maxChannels`,
     * which also counts each element once regardless of `universeCount`.
     */
    startChannel: number;
}

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
    protocol: XlNetworkProtocol;
    /** FPP-proxy host this controller is reached through (`FPPProxy` attr,
     *  falling back to the networks root's `GlobalFPPProxy`); '' when none. */
    fppProxy: string;
    /** `ForceLocalIP` attr (falling back to root `GlobalForceLocalIP`); '' when
     *  none — the local NIC xLights binds when sending here (a multi-NIC hint). */
    forceLocalIP: string;

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
     * wins, default 1440. (xLights writes the same value on every network
     * of a controller.)
     */
    channelsPerPacket: number;
    /**
     * `KeepChannelNumbers` (DDP option) — the LAST `<network>` child's value
     * wins, default false.
     */
    keepChannelNumbers: boolean;

    /**
     * Per-`<network>` output objects in document order, carrying the fields
     * the parallel arrays above drop (NetworkType, ComPort, UniverseCount,
     * DDP options per network) plus a computed absolute start channel.
     */
    outputs: XlControllerOutput[];

    // ---- Optional <Controller> attributes (set-vs-unset semantics: -------
    // ---- absent = attribute not written in the XML, no default-fill) -----

    /** `AutoSize` attr ("1"/"0"). */
    autoSize?: boolean;
    /** `FromBase` attr ("1"/"0") — controller came from the base show folder. */
    fromBase?: boolean;
    /** `FullxLightsControl` attr ("TRUE"; only written when enabled). */
    fullxLightsControl?: boolean;
    /** `DefaultBrightnessUnderFullControl` attr (percent int; upstream default 100). */
    defaultBrightnessUnderFullControl?: number;
    /** `DefaultGammaUnderFullControl` attr (float; upstream default 1.0). */
    defaultGammaUnderFullControl?: number;
    /** `AutoLayout` attr ("1"/"0"). */
    autoLayout?: boolean;
    /** `AutoUpload` attr ("1"/"0"). */
    autoUpload?: boolean;
    /** `SuppressDuplicates` attr ("1"/"0") — suppress duplicate frames. */
    suppressDuplicates?: boolean;
    /** `Priority` attr (E1.31/ZCPP priority int; upstream default 100). */
    priority?: number;
    /** `Version` attr, kept raw (upstream ControllerEthernet stores an int). */
    version?: string;
    /** `UPS` attr ("TRUE"/"FALSE") — universe-per-string. */
    ups?: boolean;

    // ---- Serial-controller attributes (ControllerSerial::Save writes -----
    // ---- Port/Speed/Prefix/Postfix on the <Controller> element) ----------

    /** `Port` attr — COM port / tty device; for Vendor "FPP" the form is
     *  "ip:device" (e.g. "192.168.1.50:ttyUSB0"). Serial controllers only. */
    serialPort?: string;
    /** `Speed` attr — baud rate. Serial controllers only. */
    serialSpeed?: number;
    /** `Prefix` attr — Generic Serial saveable prefix. */
    serialPrefix?: string;
    /** `Postfix` attr — Generic Serial saveable postfix. */
    serialPostfix?: string;
}

/**
 * Full capture of a model's `<ControllerConnection>` element (everything
 * except Port/Protocol, which stay on the flat `controllerPort` /
 * `controllerProtocol` fields for compatibility).
 *
 * EVERY field is optional with set-vs-unset semantics: a field is present
 * only when the attribute is written in the XML.  xLights only writes these
 * attributes when the user has set them (ControllerConnection active_props),
 * and "set vs unset" matters downstream — an unset brightness means "leave
 * the controller's own default alone", NOT "brightness 100".  Do not
 * default-fill.
 *
 * Attribute names follow upstream XmlNodeKeys.h / ControllerConnection.cpp;
 * Brightness/Reverse/ZigZag also accept the legacy lowercase forms
 * (brightness/reverse/zigZag) written by pre-2026.3 xLights and forks
 * (see CONTROLLER_CONNECTION_RENAMES in xmlmigrate.ts).  The upstream
 * PascalCase form wins if both are present.
 */
export interface XlControllerConnectionInfo {
    /** `Brightness` (legacy `brightness`) — percent int (upstream default 100). */
    brightness?: number;
    /** `gamma` — float. */
    gamma?: number;
    /** `colorOrder` — e.g. 'RGB', 'GRB'. */
    colorOrder?: string;
    /** `nullNodes` — start null pixels. */
    nullNodes?: number;
    /** `endNullNodes` — end null pixels. */
    endNullNodes?: number;
    /** `groupCount` — pixel grouping. */
    groupCount?: number;
    /** `Reverse` (legacy `reverse`) — "1" = true. */
    reverse?: boolean;
    /** `ZigZag` (legacy `zigZag`) — zig-zag every N nodes (int). */
    zigZag?: number;
    /** `Speed` — serial/pixel protocol speed. */
    speed?: number;
    /** `channel` — DMX channel for serial-protocol connections. */
    dmxChannel?: number;
    /** `SmartRemote` — smart remote number (0 = none). */
    smartRemote?: number;
    /** `SmartRemoteType` — e.g. 'falcon_v1', 'FPP'. */
    smartRemoteType?: string;
    /** `SRMaxCascade` — max cascaded remotes; absent means 1. */
    srMaxCascade?: number;
    /** `SRCascadeOnPort` — "1" = true. */
    srCascadeOnPort?: boolean;
    /** `ts` — smart-remote T-splitter count. */
    ts?: number;
}

/** Parse a `<ControllerConnection>` element; only set-in-XML keys appear. */
function parseControllerConnection(cc: Element): XlControllerConnectionInfo {
    const out: XlControllerConnectionInfo = {};
    const set = <K extends keyof XlControllerConnectionInfo>(
        k: K, v: XlControllerConnectionInfo[K] | undefined,
    ): void => {
        if (v !== undefined) out[k] = v;
    };
    set('brightness', optIntAttr(cc, 'Brightness') ?? optIntAttr(cc, 'brightness'));
    set('gamma', optFloatAttr(cc, 'gamma'));
    set('colorOrder', optAttr(cc, 'colorOrder'));
    set('nullNodes', optIntAttr(cc, 'nullNodes'));
    set('endNullNodes', optIntAttr(cc, 'endNullNodes'));
    set('groupCount', optIntAttr(cc, 'groupCount'));
    set('reverse', optBoolAttr(cc, 'Reverse') ?? optBoolAttr(cc, 'reverse'));
    set('zigZag', optIntAttr(cc, 'ZigZag') ?? optIntAttr(cc, 'zigZag'));
    set('speed', optIntAttr(cc, 'Speed'));
    set('dmxChannel', optIntAttr(cc, 'channel'));
    set('smartRemote', optIntAttr(cc, 'SmartRemote'));
    set('smartRemoteType', optAttr(cc, 'SmartRemoteType'));
    set('srMaxCascade', optIntAttr(cc, 'SRMaxCascade'));
    set('srCascadeOnPort', optBoolAttr(cc, 'SRCascadeOnPort'));
    set('ts', optIntAttr(cc, 'ts'));
    return out;
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
     * Node count from the parsed geometry — the pixel count for pixel models.
     * This is the count to compare against a controller's per-port pixel count
     * (channelCount / channelsPerNode, without guessing channels-per-pixel).
     */
    nodeCount: number;

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

    /**
     * Controller NAME this model is bound to (`Controller` attr on `<model>`);
     * '' when the model isn't assigned to a controller (older channel-based
     * shows, or props not yet plugged in). Matches `XlControllerInfo.name`.
     */
    controllerName: string;
    /**
     * Physical controller output port from the model's `<ControllerConnection
     * Port="...">` child; 0 when there is no connection element. This is the
     * xLights *intent* — which port the prop is meant to plug into.
     */
    controllerPort: number;
    /** Pixel protocol declared on `<ControllerConnection Protocol="...">`; ''. */
    controllerProtocol: XlPixelProtocol;
    /**
     * Full capture of the `<ControllerConnection>` element's remaining
     * attributes (brightness/gamma/colorOrder/nulls/smart-remote/...).
     * Present exactly when the model has a `<ControllerConnection>` child
     * with at least one attribute (legacy files write an empty element on
     * every model — that counts as absent); within it, each field is present
     * only when set in the XML.
     */
    controllerConnection?: XlControllerConnectionInfo;

    /**
     * `ModelChain` attr — ">OtherModel" when this model is chained after
     * another on the same controller port (xLights AutoLayout wiring order),
     * "Beginning" or absent when it heads the chain. Present only when
     * written in the XML.
     */
    modelChain?: string;
    /** `ShadowModelFor` attr — the model this one shadows; set-vs-unset. */
    shadowModelFor?: string;

    /**
     * Number of PHYSICAL strings the model's geometry declares (the xLights
     * "# Strings" property); 1 for inherently single-string models.  This is
     * the count a controller-port spreader uses when one model fans out over
     * several ports.
     */
    numPhysicalStrings: number;
    /**
     * Node count of each physical string, length == numPhysicalStrings.
     * Sums to nodeCount.
     */
    stringNodeCounts: number[];
    /**
     * Absolute 1-based first channel of each physical string, parallel to
     * stringNodeCounts.  For normal (non-advanced) models these are
     * consecutive within the model's channel range; models using xLights
     * "individual start channels" (advanced mode) may be non-consecutive
     * where the geometry class supports it (Arches, Matrix, Single Line).
     * See derivePhysicalStrings for how the split is derived.
     */
    stringStartChannels: number[];
}

export interface ControllersAndModelChannels {
    controllers: XlControllerInfo[];
    models: XlModelChannelInfo[];

    // ---- Optional attributes of the <Networks> root element --------------
    // ---- (set-vs-unset: absent when not written / empty in the XML) ------

    /** `computer` attr — hostname of the machine that saved the file. */
    computer?: string;
    /** `AutoUpdateFromBase` attr ("1"/"0"). */
    autoUpdateFromBase?: boolean;
    /** `BaseShowDir` attr — the base show directory path. */
    baseShowDir?: string;
    /** `BaseShowDirRelative` attr — base dir relative to the show dir. */
    baseShowDirRelative?: string;
    /** `BaseControllersSyncedTime` attr, kept raw. */
    baseControllersSyncedTime?: string;
    /** `<e131sync universe="..."/>` child — E1.31 sync universe (0 = off,
     *  only written when non-zero). */
    syncUniverse?: number;
    /** `<suppressframes frames="..."/>` child — identical-frame suppression
     *  count (only written when non-zero). */
    suppressFrames?: number;
    // <testpreset> children (xLights test-dialog presets) are not parsed.
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

    // Networks-level proxy defaults; a per-controller attr overrides these.
    const globalFppProxy = getAttrDef(root, 'GlobalFPPProxy', '');
    const globalForceLocalIP = getAttrDef(root, 'GlobalForceLocalIP', '');

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
        const outputs: XlControllerOutput[] = [];
        let maxChannels = 0;
        let channelsPerPacket = 1440;
        let keepChannelNumbers = false;

        for (const net of getChildElementsByTag(cn, 'network')) {
            const size = getNumAttrDef(net, 'MaxChannels', 510);
            // xLights stores the E1.31 universe number in 'BaudRate' — but on
            // Serial controllers the same attribute is the actual baud rate,
            // so it must not enter the universe map there.
            if (type !== 'Serial') {
                universeNumbers.push(getNumAttrDef(net, 'BaudRate', 1));
                universeSizes.push(size);
            }

            // An explicit Universe attr (synthetic files) wins over the
            // BaudRate real xLights writes — same precedence as
            // resolveStartChannelString's universe lookup.
            const output: XlControllerOutput = {
                maxChannels: size,
                startChannel: startChannel + maxChannels,
            };
            const networkType = optAttr(net, 'NetworkType');
            if (networkType !== undefined) output.networkType = networkType;
            const comPort = optAttr(net, 'ComPort');
            if (comPort !== undefined) output.comPort = comPort;
            if (type === 'Serial') {
                const baud = optIntAttr(net, 'BaudRate');
                if (baud !== undefined) output.baudRate = baud;
            } else {
                const universe = optIntAttr(net, 'Universe') ?? optIntAttr(net, 'BaudRate');
                if (universe !== undefined) output.universe = universe;
            }
            const universeCount = optIntAttr(net, 'UniverseCount');
            if (universeCount !== undefined) output.universeCount = universeCount;
            const cpp = optIntAttr(net, 'ChannelsPerPacket');
            if (cpp !== undefined) output.channelsPerPacket = cpp;
            const kcn = optBoolAttr(net, 'KeepChannelNumbers');
            if (kcn !== undefined) output.keepChannelNumbers = kcn;
            outputs.push(output);

            maxChannels += size;
            // Deliberately last-network-wins (see interface docs).
            channelsPerPacket = getNumAttrDef(net, 'ChannelsPerPacket', 1440);
            keepChannelNumbers = getBoolAttrDef(net, 'KeepChannelNumbers', false);
        }

        const info: XlControllerInfo = {
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
            fppProxy: getAttrDef(cn, 'FPPProxy', '') || globalFppProxy,
            forceLocalIP: getAttrDef(cn, 'ForceLocalIP', '') || globalForceLocalIP,
            startChannel,
            maxChannels,
            universeNumbers,
            universeSizes,
            channelsPerPacket,
            keepChannelNumbers,
            outputs,
        };

        // Optional <Controller> attributes — set only when written in the XML.
        const autoSize = optBoolAttr(cn, 'AutoSize');
        if (autoSize !== undefined) info.autoSize = autoSize;
        const fromBase = optBoolAttr(cn, 'FromBase');
        if (fromBase !== undefined) info.fromBase = fromBase;
        const fullxLightsControl = optBoolAttr(cn, 'FullxLightsControl');
        if (fullxLightsControl !== undefined) info.fullxLightsControl = fullxLightsControl;
        const defBrightness = optIntAttr(cn, 'DefaultBrightnessUnderFullControl');
        if (defBrightness !== undefined) info.defaultBrightnessUnderFullControl = defBrightness;
        const defGamma = optFloatAttr(cn, 'DefaultGammaUnderFullControl');
        if (defGamma !== undefined) info.defaultGammaUnderFullControl = defGamma;
        const autoLayout = optBoolAttr(cn, 'AutoLayout');
        if (autoLayout !== undefined) info.autoLayout = autoLayout;
        const autoUpload = optBoolAttr(cn, 'AutoUpload');
        if (autoUpload !== undefined) info.autoUpload = autoUpload;
        const suppressDuplicates = optBoolAttr(cn, 'SuppressDuplicates');
        if (suppressDuplicates !== undefined) info.suppressDuplicates = suppressDuplicates;
        const priority = optIntAttr(cn, 'Priority');
        if (priority !== undefined) info.priority = priority;
        const version = optAttr(cn, 'Version');
        if (version !== undefined) info.version = version;
        const ups = optBoolAttr(cn, 'UPS');
        if (ups !== undefined) info.ups = ups;

        // Serial-controller attributes (written on the <Controller> element).
        const serialPort = optAttr(cn, 'Port');
        if (serialPort !== undefined) info.serialPort = serialPort;
        const serialSpeed = optIntAttr(cn, 'Speed');
        if (serialSpeed !== undefined) info.serialSpeed = serialSpeed;
        const serialPrefix = optAttr(cn, 'Prefix');
        if (serialPrefix !== undefined) info.serialPrefix = serialPrefix;
        const serialPostfix = optAttr(cn, 'Postfix');
        if (serialPostfix !== undefined) info.serialPostfix = serialPostfix;

        controllers.push(info);

        startChannel += maxChannels;
    }

    return controllers;
}

/**
 * Derive the per-physical-string exposure for a model.
 *
 * Preference order:
 *  1. The channel mapping's own per-string runs, when the model class
 *     reports more than one string to the channel machinery (Arches —
 *     including unequal layered arches — Matrix, Single Line).  This also
 *     carries advanced-mode (individual start channel) placement exactly.
 *  2. The geometry's declared physical string count
 *     (BaseModelClass.getNumPhysicalStrings — Tree, Circle, Star, Icicles,
 *     Spinner, Cube, Custom, Wreath, Sphere, Candy Canes), split by EQUAL
 *     division of the node count with consecutive channels.  Equal division
 *     is exactly what those geometries define (numStrings × nodesPerString
 *     and variants); it is also what xLights CustomModel does channel-wise
 *     when the node count divides evenly.
 *  3. Single string covering the whole model (also the fallback when the
 *     node count does not divide evenly by the declared count — e.g. a
 *     Custom model whose max cell value isn't a multiple of its string
 *     count — where no faithful split is derivable from the geometry).
 */
function derivePhysicalStrings(
    mapping: ModelChannelMapping,
    modelObj: BaseModelClass | undefined,
): { numPhysicalStrings: number; stringNodeCounts: number[]; stringStartChannels: number[] } {
    if (mapping.numStrings > 1 && mapping.nodeChannelMap.length > 1) {
        const runs = [...mapping.nodeChannelMap].sort((a, b) => a.stringIndex - b.stringIndex);
        return {
            numPhysicalStrings: mapping.numStrings,
            stringNodeCounts: runs.map(r => r.nodeCount),
            // ChannelRun.channelStart is 0-based; surface 1-based.
            stringStartChannels: runs.map(r => r.channelStart + 1),
        };
    }

    const totalNodes = mapping.totalNodes;
    const declared = modelObj ? modelObj.getNumPhysicalStrings() : 1;
    if (declared > 1 && totalNodes > 0 && totalNodes % declared === 0) {
        const nodesPerString = totalNodes / declared;
        const stringNodeCounts: number[] = [];
        const stringStartChannels: number[] = [];
        for (let s = 0; s < declared; s++) {
            stringNodeCounts.push(nodesPerString);
            stringStartChannels.push(
                mapping.firstChannel + 1 + s * nodesPerString * mapping.channelsPerNode);
        }
        return { numPhysicalStrings: declared, stringNodeCounts, stringStartChannels };
    }

    return {
        numPhysicalStrings: 1,
        stringNodeCounts: [totalNodes],
        stringStartChannels: [mapping.firstChannel + 1],
    };
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
    const objByName = new Map(modelObjs.map(m => [m.name, m]));
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
            // Modern xLights binds a model to a controller port via the
            // `Controller` attr + a `<ControllerConnection>` child. Port/Protocol
            // are stable attr names across formats (only brightness/reverse/zigZag
            // get case-renamed), so no migration is needed to read them.
            const cc = getOptionalElementByTag(mdl, 'ControllerConnection');

            const strings = derivePhysicalStrings(resolved.channelMapping, objByName.get(name));

            const model: XlModelChannelInfo = {
                name,
                displayAs: getAttrDef(mdl, 'DisplayAs', ''),
                // channelMapping is 0-based internally; surface 1-based.
                startChannel: resolved.channelMapping.firstChannel + 1,
                channelCount: resolved.channelMapping.totalChannels,
                rgbOffsets: rgbOffsets ? { ...rgbOffsets } : { r: 0, g: 1, b: 2 },
                simple: !!rgbOffsets,
                gamma,
                brightness,
                nodeCount: resolved.channelMapping.totalNodes,
                controllerName: getAttrDef(mdl, 'Controller', ''),
                controllerPort: cc ? getNumAttrDef(cc, 'Port', 0) : 0,
                controllerProtocol: cc ? getAttrDef(cc, 'Protocol', '') : '',
                numPhysicalStrings: strings.numPhysicalStrings,
                stringNodeCounts: strings.stringNodeCounts,
                stringStartChannels: strings.stringStartChannels,
            };
            const modelChain = optAttr(mdl, 'ModelChain');
            if (modelChain !== undefined) model.modelChain = modelChain;
            const shadowModelFor = optAttr(mdl, 'ShadowModelFor');
            if (shadowModelFor !== undefined) model.shadowModelFor = shadowModelFor;
            // Present only when the element exists AND carries at least one
            // attribute: legacy (x2026_2) files write an empty
            // <ControllerConnection/> on every model where the x2026_3 format
            // omits the element — an attribute-less element carries no
            // information, so both count as "no connection config".
            if (cc && cc.attributes.length > 0) {
                model.controllerConnection = parseControllerConnection(cc);
            }
            models.push(model);
        }
    }

    const result: ControllersAndModelChannels = { controllers, models };

    // Optional <Networks> root attributes (set-vs-unset semantics).
    const nroot = networksDoc.documentElement;
    if (nroot) {
        const computer = optAttr(nroot, 'computer');
        if (computer !== undefined) result.computer = computer;
        const autoUpdateFromBase = optBoolAttr(nroot, 'AutoUpdateFromBase');
        if (autoUpdateFromBase !== undefined) result.autoUpdateFromBase = autoUpdateFromBase;
        const baseShowDir = optAttr(nroot, 'BaseShowDir');
        if (baseShowDir !== undefined) result.baseShowDir = baseShowDir;
        const baseShowDirRelative = optAttr(nroot, 'BaseShowDirRelative');
        if (baseShowDirRelative !== undefined) result.baseShowDirRelative = baseShowDirRelative;
        const baseControllersSyncedTime = optAttr(nroot, 'BaseControllersSyncedTime');
        if (baseControllersSyncedTime !== undefined) result.baseControllersSyncedTime = baseControllersSyncedTime;

        // Root children (each written only when its value is non-zero).
        const e131sync = getOptionalElementByTag(nroot, 'e131sync');
        if (e131sync) {
            const u = optIntAttr(e131sync, 'universe');
            if (u !== undefined) result.syncUniverse = u;
        }
        const suppress = getOptionalElementByTag(nroot, 'suppressframes');
        if (suppress) {
            const f = optIntAttr(suppress, 'frames');
            if (f !== undefined) result.suppressFrames = f;
        }
    }

    return result;
}
