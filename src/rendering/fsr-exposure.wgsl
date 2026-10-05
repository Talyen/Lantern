/* Exposure metering adapted from @pmndrs/upscaler 0.2.0.
 * Same 32x32 sampling grid, reduced cooperatively by one 64-lane workgroup.
 * See LICENSE-upscaler.txt for the MIT notice.
 */
struct FsrConstants {
    renderSize      : vec2f,  // offset  0 — jittered render resolution (px)
    displaySize     : vec2f,  // offset  8 — output resolution (px)
    renderSizeInv   : vec2f,  // offset 16
    displaySizeInv  : vec2f,  // offset 24
    jitter          : vec2f,  // offset 32 — current sub-pixel offset (render px, top-left origin)
    jitterPrev      : vec2f,  // offset 40
    motionScale     : vec2f,  // offset 48 — NDC velocity delta -> UV delta (0.5, -0.5)
    depthNearFar    : vec2f,  // offset 56 — camera near/far for linearization
    sharpness       : f32,    // offset 64 — RCAS attenuation 0..1 (1 = sharpest)
    maxAccumulation : f32,    // offset 68 — max history sample count
    exposure        : f32,    // offset 72 — pre-exposure before invertible tonemap
    deltaTime       : f32,    // offset 76 — seconds
    flags           : u32,    // offset 80 — FLAG_* bits
    frameIndex      : u32,    // offset 84
    debugMode       : u32,    // offset 88 — DebugView
    _pad            : u32,    // offset 92
}
@group(0) @binding(0) var<uniform> C : FsrConstants;

const FLAG_RESET : u32 = 1u;
const FLAG_REVERSED_DEPTH : u32 = 2u;
const FLAG_PERSPECTIVE : u32 = 4u;
const FLAG_INPUT_REINHARD : u32 = 8u;
const FLAG_INPUT_DISPLAY : u32 = 16u;
const FLAG_LOCKS : u32 = 32u;
const FLAG_AUTO_EXPOSURE : u32 = 64u;
const FLAG_SHADING_CHANGE : u32 = 128u;
const FLAG_REACTIVE : u32 = 256u;
const FLAG_RCAS_DENOISE : u32 = 512u;
const FLAG_EXTERNAL_EXPOSURE : u32 = 1024u;

fn hasFlag(bit : u32) -> bool { return (C.flags & bit) != 0u; }

fn luma(c : vec3f) -> f32 {
    return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}


@group(0) @binding(1) var inputColor : texture_2d<f32>;
@group(0) @binding(2) var linearSampler : sampler;
@group(0) @binding(3) var prevExposure : texture_2d<f32>;
@group(0) @binding(4) var exposureOut : texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var externalExposure : texture_2d<f32>;
@group(0) @binding(6) var hostPreExposure : texture_2d<f32>;

// 32×32 = 1024 bilinear taps across the whole frame — a coarse but stable
// average for exposure (each tap already averages 4 texels).
const EXPOSURE_TAPS : u32 = 32u;
// Middle-grey target: the exposure maps average scene luma to this.
const EXPOSURE_KEY : f32 = 0.18;
// Clamp so a pitch-black or fully blown-out frame can't drive exposure to
// infinity/zero and destabilize the accumulation it is meant to steady.
const EXPOSURE_MIN : f32 = 0.02;
const EXPOSURE_MAX : f32 = 80.0;
// Eye-adaptation rate (per second) toward the target exposure.
const ADAPT_SPEED : f32 = 2.5;

var<workgroup> partialLuma : array<f32, 64>;

@compute @workgroup_size(8, 8)
fn main(@builtin(local_invocation_index) lane : u32) {

    // Geometric mean of luminance (average in log space) resists a few bright
    // pixels dragging the whole exposure, matching FSR2's log-average.
    var localSum = 0.0;
    for (var tap = lane; tap < EXPOSURE_TAPS * EXPOSURE_TAPS; tap += 64u) {
        let coord = vec2u(tap % EXPOSURE_TAPS, tap / EXPOSURE_TAPS);
        let uv = (vec2f(coord) + 0.5) / f32(EXPOSURE_TAPS);
        let c = textureSampleLevel(inputColor, linearSampler, uv, 0.0).rgb;
        localSum += log2(max(luma(c), 1.0e-4));
    }
    partialLuma[lane] = localSum;
    workgroupBarrier();
    for (var stride = 32u; stride > 0u; stride /= 2u) {
        if (lane < stride) { partialLuma[lane] += partialLuma[lane + stride]; }
        workgroupBarrier();
    }
    if (lane != 0u) { return; }
    let logSum = partialLuma[0];
    // Meter host-invariantly (FSR2 divides pre-exposure out of every input
    // load): the app already metered what it baked in, so a host pre-exposure
    // step must not send auto-exposure re-adapting — that multi-frame
    // conditioning drift would desynchronize history from the current frame
    // and read as a full-screen shading change.
    let hostRaw = textureLoad(hostPreExposure, vec2i(0), 0).r;
    let host = select(1.0, hostRaw, hostRaw > 0.0);
    let avgLum = exp2(logSum / f32(EXPOSURE_TAPS * EXPOSURE_TAPS)) / host;

    let targetExposure = clamp(EXPOSURE_KEY / max(avgLum, 1.0e-4), EXPOSURE_MIN, EXPOSURE_MAX);

    // Ease toward the target for eye-adaptation; snap on reset so a stale value
    // doesn't slowly fade in after a camera cut / resize.
    let prev = textureLoad(prevExposure, vec2i(0), 0).r;
    var exposure = targetExposure;
    if (!hasFlag(FLAG_RESET) && prev > 0.0) {
        let rate = clamp(1.0 - exp2(-C.deltaTime * ADAPT_SPEED), 0.0, 1.0);
        exposure = prev + (targetExposure - prev) * rate;
    }

    // Manual override: when auto-exposure is off, publish the fixed setting so
    // downstream passes read exposure from one place regardless of mode.
    exposure = select(C.exposure, exposure, hasFlag(FLAG_AUTO_EXPOSURE));

    // App-supplied exposure wins over both: a pipeline that already computes
    // exposure (its own metering pass) feeds it here, and every downstream
    // pass keeps reading this one 1×1 value. avgLum stays our own measurement
    // so the shading-change detector still has a neighbourhood reference.
    let ext = textureLoad(externalExposure, vec2i(0), 0).r;
    exposure = select(exposure, ext, hasFlag(FLAG_EXTERNAL_EXPOSURE));

    // Host pre-exposure rides along in .b: 0 (the dummy) means "not supplied"
    // and publishes as 1.0 so the accumulate-side ratio correction is inert.
    textureStore(exposureOut, vec2i(0), vec4f(exposure, avgLum, host, 0.0));
}
