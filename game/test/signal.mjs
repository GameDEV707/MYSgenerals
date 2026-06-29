// MYS Generals — T33 serverless signaling codec test (spec §24 T33-B3).
// Verifies the invite/reply blob encode→decode round-trip, tolerant parsing (#join= fragments,
// whitespace, the standard base64 alphabet), and rejection of malformed codes. Pure + offline —
// the REAL WebRTC connection is browser/internet-only and is verified manually by the user.
// Run: NODE_OPTIONS="" node test/signal.mjs
import { encodeSignal, decodeSignal, SIGNAL_VERSION } from "../dist/net/signal.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

// A representative (trimmed) SDP — the codec must carry arbitrary multi-line SDP text intact.
const OFFER_SDP = "v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=candidate:1 1 udp 2113 192.168.1.5 54321 typ host\r\na=mid:0\r\na=sctp-port:5000\r\n";
const ANSWER_SDP = "v=0\r\no=- 999 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=mid:0\r\na=sctp-port:5000\r\n";

console.log("Invite (offer) round-trip:");
const inviteCode = encodeSignal({ t: "offer", sdp: OFFER_SDP });
assert(typeof inviteCode === "string" && inviteCode.length > 0, "invite encodes to a non-empty code");
assert(!/[\s]/.test(inviteCode), "invite code has no whitespace (paste-safe)");
const inv = decodeSignal(inviteCode);
assert(inv !== null, "invite decodes");
assert(inv.t === "offer", "invite kind preserved (offer)");
assert(inv.sdp === OFFER_SDP, "invite SDP byte-identical after round-trip");
assert(inv.v === SIGNAL_VERSION, "invite carries the format version");

console.log("Reply (answer) round-trip:");
const replyCode = encodeSignal({ t: "answer", sdp: ANSWER_SDP });
const rep = decodeSignal(replyCode);
assert(rep && rep.t === "answer" && rep.sdp === ANSWER_SDP, "reply kind + SDP preserved");

console.log("Optional ICE array is preserved when present:");
const withIce = decodeSignal(encodeSignal({ t: "offer", sdp: OFFER_SDP, ice: ["cand-a", "cand-b"] }));
assert(withIce && Array.isArray(withIce.ice) && withIce.ice.length === 2, "ice[] round-trips");
const noIce = decodeSignal(encodeSignal({ t: "offer", sdp: OFFER_SDP }));
assert(noIce && noIce.ice === undefined, "absent ice[] stays absent (compact)");

console.log("Tolerant decoding:");
assert(decodeSignal("  " + inviteCode + "\n") !== null, "leading/trailing whitespace tolerated");
assert(decodeSignal(inviteCode.replace(/(.{20})/g, "$1\n")) !== null, "line-wrapped paste tolerated");
const frag = decodeSignal("https://example.com/game#join=" + inviteCode);
assert(frag !== null && frag.t === "offer" && frag.sdp === OFFER_SDP, "a #join=<code> URL fragment decodes");
assert(decodeSignal("#join=" + inviteCode) !== null, "a bare #join= fragment decodes");

console.log("Rejects malformed / non-signal input:");
assert(decodeSignal("") === null, "empty string → null");
assert(decodeSignal("not a real code !!!") === null, "garbage → null");
assert(decodeSignal("https://example.com/game") === null, "a URL with no join= param → null");
assert(decodeSignal(encodeSignal({ t: "offer", sdp: "" })) === null, "an empty SDP is rejected");
// A well-formed base64 of a JSON object that isn't a signal blob.
const bogus = Buffer.from(JSON.stringify({ hello: "world" })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
assert(decodeSignal(bogus) === null, "valid base64 of a non-signal object → null");

console.log("");
if (failures === 0) { console.log("ALL SIGNAL TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " SIGNAL TEST(S) FAILED ✗"); process.exit(1); }
