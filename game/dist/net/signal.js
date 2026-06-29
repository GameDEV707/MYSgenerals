// MYS Generals — serverless WebRTC signaling codec (spec §24 T33-B3).
//
// Truly serverless WebRTC still needs the two endpoints to exchange their SDP + ICE once, out of
// band. We do that with a copy/paste CODE rather than a broker: the host packs its offer into an
// INVITE code, the joiner packs its answer into a REPLY code. This module is the pure, dependency-
// free encoder/decoder for those blobs — no DOM, no Node built-ins — so it is fully unit-testable
// in the headless runner (test/signal.mjs).
//
// We gather ICE to completion (non-trickle) before encoding, so the candidates are already baked
// into the SDP; `ice[]` is therefore optional and kept only for forward tolerance. The payload is
// JSON → UTF-8 → URL-safe base64, small enough to paste and to ride in a `#join=` URL fragment.
export const SIGNAL_VERSION = 1;
// ---- portable UTF-8 <-> bytes (TextEncoder/Decoder are globals in both browsers and Node ≥ 11) ----
function toBytes(s) { return new TextEncoder().encode(s); }
function fromBytes(b) { return new TextDecoder().decode(b); }
// ---- portable base64 (URL-safe: + → -, / → _, no padding) over raw bytes ----
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64_INV = (() => {
    const m = {};
    for (let i = 0; i < B64.length; i++)
        m[B64[i]] = i;
    // Tolerate the standard alphabet too, so codes copied through tools that re-encode still load.
    m["+"] = 62;
    m["/"] = 63;
    return m;
})();
function bytesToB64(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i];
        const b1 = i + 1 < bytes.length ? bytes[i + 1] : -1;
        const b2 = i + 2 < bytes.length ? bytes[i + 2] : -1;
        out += B64[b0 >> 2];
        out += B64[((b0 & 3) << 4) | (b1 >= 0 ? b1 >> 4 : 0)];
        if (b1 >= 0)
            out += B64[((b1 & 15) << 2) | (b2 >= 0 ? b2 >> 6 : 0)];
        if (b2 >= 0)
            out += B64[b2 & 63];
    }
    return out;
}
function b64ToBytes(s) {
    // Strip whitespace/newlines (pasted codes often wrap) and any padding.
    const clean = s.replace(/[\s=]/g, "");
    const out = [];
    for (let i = 0; i < clean.length; i += 4) {
        const c0 = B64_INV[clean[i]];
        const c1 = B64_INV[clean[i + 1]];
        const c2 = i + 2 < clean.length ? B64_INV[clean[i + 2]] : undefined;
        const c3 = i + 3 < clean.length ? B64_INV[clean[i + 3]] : undefined;
        if (c0 === undefined || c1 === undefined)
            break;
        out.push((c0 << 2) | (c1 >> 4));
        if (c2 !== undefined)
            out.push(((c1 & 15) << 4) | (c2 >> 2));
        if (c2 !== undefined && c3 !== undefined)
            out.push(((c2 & 3) << 6) | c3);
    }
    return new Uint8Array(out);
}
// Encode an invite/reply blob to a compact, paste-friendly code.
export function encodeSignal(blob) {
    const payload = { t: blob.t, sdp: blob.sdp, v: blob.v ?? SIGNAL_VERSION };
    if (blob.ice && blob.ice.length)
        payload.ice = blob.ice;
    return bytesToB64(toBytes(JSON.stringify(payload)));
}
// Tolerant decoder: accepts a bare code, a `#join=<code>` fragment, or a full URL carrying one,
// and validates the shape. Returns null on anything malformed (never throws).
export function decodeSignal(code) {
    if (!code)
        return null;
    let raw = code.trim();
    // Pull the code out of a URL / hash fragment if the whole link was pasted.
    const m = raw.match(/[#?&]join=([^#&\s]+)/);
    if (m)
        raw = m[1];
    // A pasted full URL with no join= param can't be decoded.
    if (/^https?:\/\//i.test(raw))
        return null;
    try {
        const json = fromBytes(b64ToBytes(raw));
        const obj = JSON.parse(json);
        if (!obj || (obj.t !== "offer" && obj.t !== "answer") || typeof obj.sdp !== "string" || !obj.sdp)
            return null;
        const blob = { t: obj.t, sdp: obj.sdp, v: typeof obj.v === "number" ? obj.v : SIGNAL_VERSION };
        if (Array.isArray(obj.ice))
            blob.ice = obj.ice.filter((x) => typeof x === "string");
        return blob;
    }
    catch {
        return null;
    }
}
