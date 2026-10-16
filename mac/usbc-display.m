// usbc-display: the Mac side of the USB-C second monitor.
//
// Adds a virtual monitor to macOS, captures it with ScreenCaptureKit and sends it to the
// Windows receiver over the network the USB-C cable provides (Thunderbolt Bridge <-> USB4
// P2P), as exact pixels: the tiles that changed, LZ4-compressed on all cores.
//
// The link: the Windows USB4 network driver stops receiving for good when packets spanning
// several 4 KB Thunderbolt frames arrive, which macOS sends whenever TCP segmentation offload
// (TSO) bundles a burst into one big packet. Every send here goes out in pieces of at most two
// TCP segments, the next one only once the previous has left (linkSend), so no packet ever
// spans two frames; tested at 800+ MB/s over 100 GB with no stall. The pointer, heartbeats
// and clock sync travel on their own connection so they never wait behind pictures.
//
// Build: ./build.sh (also makes dist/USB-C Display.app, the one people install)
// Run:   ./usbc-display [--native] [--mirror] [--h264] [--no-lz4] [--port N] [--bench [FPS]] [--agent]

#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <VideoToolbox/VideoToolbox.h>
#import <IOKit/pwr_mgt/IOPMLib.h>
#import <Metal/Metal.h>
#import <MetalPerformanceShaders/MetalPerformanceShaders.h>
#import <Accelerate/Accelerate.h>
#import <ColorSync/ColorSync.h>
#import <ApplicationServices/ApplicationServices.h>
#import <ServiceManagement/ServiceManagement.h>
#include <compression.h>
#include <crt_externs.h>
#include <dlfcn.h>
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <ifaddrs.h>
#include <mach/mach_time.h>
#include <mach-o/dyld.h>
#include <net/if.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <pthread.h>
#include <pthread/qos.h>
#include <poll.h>
#include <spawn.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <sys/xattr.h>

// ---- Private CoreGraphics API (macOS 11+) that virtual-display apps are built on ----
@interface CGVirtualDisplayDescriptor : NSObject
@property (retain, nonatomic) dispatch_queue_t queue;
@property (retain, nonatomic) NSString *name;
@property (nonatomic) unsigned int maxPixelsWide;
@property (nonatomic) unsigned int maxPixelsHigh;
@property (nonatomic) CGSize sizeInMillimeters;
@property (nonatomic) unsigned int productID;
@property (nonatomic) unsigned int vendorID;
@property (nonatomic) unsigned int serialNum;
@end
@interface CGVirtualDisplayMode : NSObject
- (instancetype)initWithWidth:(unsigned int)width height:(unsigned int)height refreshRate:(double)refreshRate;
@end
@interface CGVirtualDisplaySettings : NSObject
@property (retain, nonatomic) NSArray *modes;
@property (nonatomic) unsigned int hiDPI;
@end
@interface CGVirtualDisplay : NSObject
@property (readonly, nonatomic) unsigned int displayID;
- (instancetype)initWithDescriptor:(CGVirtualDisplayDescriptor *)descriptor;
- (BOOL)applySettings:(CGVirtualDisplaySettings *)settings;
@end

// ---- Wire protocol v2 (little-endian, shared with windows/Link.cs) ----
// Two TCP connections over the cable's IPv6 link-local addresses, both started by Windows:
//   control: HELLO (Windows, 24 bytes) -> WELCOME (Mac, with a token); then pointer, heartbeats,
//            clock sync and goodbye. Messages from the Mac are 32 bytes (+ payload), from
//            Windows 16 bytes.
//   frames:  JOIN with the token (Windows), then FRAMEs (Mac) and ACKs (Windows).
#define MAGIC_HELLO   0x48444355u // "UCDH"
#define MAGIC_WELCOME 0x57444355u // "UCDW"
#define MAGIC_JOIN    0x4A444355u // "UCDJ"
#define MAGIC_FRAME   0x46444355u // "UCDF"
#define MAGIC_ACK     0x41444355u // "UCDA" receiver -> Mac, once a frame is in its picture
#define MAGIC_MOUSE   0x4D444355u // "UCDM"
#define MAGIC_SHAPE   0x53444355u // "UCDS"
#define MAGIC_BEAT    0x42444355u // "UCDB" both ways, every 100 ms
#define MAGIC_TIME    0x54444355u // "UCDT" clock sync: Windows asks, the Mac answers with its clock
#define MAGIC_BYE     0x47444355u // "UCDG" the Mac is going away (agent quitting, Mac sleeping)
#define ACK_WANT_KEYFRAME 0xFFFFFFFFu  // Ack.seq from a receiver whose H.264 decoder lost track
#define PROTOCOL_VERSION 2
// ENC_REGION follows an ENC_H264 rect: copy just this area of the decoded picture to the
// screen (no data). Without regions the receiver shows the whole decoded picture.
enum { TILE_W = 64, TILE_H = 32, ENC_RAW = 0, ENC_LZ4 = 1, ENC_H264 = 2, ENC_REGION = 3 };
enum { HELLO_CAN_H264 = 1, HELLO_TEST_CARD = 2,
       HELLO_VIDEO_ONLY = 4,     // testing: H.264 only, never made exact
       HELLO_CURSOR = 8,         // the receiver draws the pointer itself: leave it out of the picture
       HELLO_V2 = 16,            // this protocol
       HELLO_H264_HYBRID = 32,   // H.264 for anything that moves (the old default)
       HELLO_LOSSLESS_ONLY = 64,
       HELLO_TEST_DRAG = 128,    // with TEST_CARD: the card is a window dragged around for 8 s
       HELLO_PROFILE = 256,      // the laptop panel's ICC profile follows the Hello
       HELLO_INPUT = 512,        // the laptop's trackpad and keyboard drive the Mac
       HELLO_STATUS = 1024 };    // answer a refusal with a STATUS message instead of just closing
#define MAGIC_PROFILE 0x50444355u // "UCDP": WinMsg {magic, length} + ICC bytes
// Input from the laptop (WinMsg). MOVE {x | y << 16}; BUTTON {button, down, x | y << 16};
// SCROLL {dy, dx (Windows wheel units), x | y << 16}; KEY {mac key code, down | repeat << 1,
// modifiers}; FLAGS {modifier key code, down, modifiers}; TEXT {Unicode code point}.
// Modifiers: 1 Shift, 2 Control, 4 Option, 8 Command.
#define MAGIC_IN_MOVE   0x6D444355u // "UCDm"
#define MAGIC_IN_BUTTON 0x62444355u // "UCDb"
#define MAGIC_IN_SCROLL 0x73444355u // "UCDs"
#define MAGIC_IN_KEY    0x6B444355u // "UCDk"
#define MAGIC_IN_TEXT   0x74444355u // "UCDt"
#define MAGIC_IN_FLAGS  0x66444355u // "UCDf"
#define MAGIC_INPUT_STATE 0x4E444355u // "UCDN" to the laptop: 1 = allowed to post input, 0 = not yet
// REL {dx, dy}: the laptop's trackpad moving the pointer while it's on another display (laptop
// pixels). BUTTON and SCROLL with position 0xFFFFFFFF happen wherever the pointer is.
#define MAGIC_IN_REL    0x72444355u // "UCDr"
#define MAGIC_LAYOUT    0x4C444355u // "UCDL" to the laptop: where other displays touch this one
#define AT_POINTER 0xFFFFFFFFu
// First-run setup (windows/setup/CONTRACT.md): the setup app opens a connection whose first
// message is QUERY (WinMsg {actions, wizard version lo, hi}); the Mac answers with STATUS and
// sends it again whenever a bit changes. More QUERYs on the same connection run more actions.
#define MAGIC_QUERY  0x51444355u // "UCDQ"
#define MAGIC_STATUS 0x49444355u // "UCDI"
#define APP_VERSION 2            // the app's build number; build.sh copies it into Info.plist
enum { ST_SCREEN_OK = 1, ST_AX_OK = 2, ST_SCREEN_PROMPTED = 4, ST_AX_PROMPTED = 8,
       ST_LOGIN_ITEM_ENABLED = 16, ST_LOGIN_ITEM_NEEDS_APPROVAL = 32, ST_SESSION_ACTIVE = 64,
       ST_RUNNING_AS_AGENT = 128, ST_IN_APPLICATIONS = 256, ST_SCREEN_NEEDS_RELAUNCH = 512 };
enum { ACT_SCREEN = 1, ACT_ACCESSIBILITY = 2, ACT_LOGIN_ITEMS = 4, ACT_RELAUNCH = 8, ACT_MOVE = 16 };
enum { REFUSE_NONE = 0, REFUSE_NO_SCREEN_RECORDING = 1 };
enum { FRAME_HAS_H264 = 1 };     // FrameHeader.flags

#pragma pack(push, 1)
typedef struct { uint32_t magic; uint16_t version, flags, width, height, scalePercent, hz, widthMm, heightMm, ptW, ptH; } Hello;
typedef struct { uint32_t magic, seq; uint16_t width, height; uint32_t rectCount, bodyBytes, flags; uint64_t captureNs; } FrameHeader;
typedef struct { uint16_t x, y, w, h; uint32_t encoding, dataBytes; } RectHeader;
typedef struct { uint32_t magic, a, b, c; } WinMsg;  // ACK {seq, receiverMicros}, BEAT {seq}, TIME {seq, ns lo, ns hi}, JOIN {token}
typedef struct { uint32_t magic, a; uint64_t b, c; uint8_t pad[8]; } CtlMsg;  // WELCOME {token}, BEAT {seq, macNs}, TIME {seq, winNs, macNs}, BYE {reason}
typedef struct { uint32_t magic; int16_t x, y; uint16_t visible, reserved; uint64_t pollNs; uint8_t pad[12]; } MouseMsg;
typedef struct { uint32_t magic; uint16_t w, h, hotX, hotY; uint32_t dataBytes; uint8_t pad[16]; } ShapeMsg;
// STATUS: version = APP_VERSION << 16 | PROTOCOL_VERSION; macOS = major << 32 | minor << 16 | patch.
typedef struct { uint32_t magic, status; uint64_t version, macOS; uint32_t refuse, zero; } StatusMsg;
#pragma pack(pop)
_Static_assert(sizeof(Hello) == 24 && sizeof(FrameHeader) == 32 && sizeof(WinMsg) == 16, "wire sizes");
_Static_assert(sizeof(CtlMsg) == 32 && sizeof(MouseMsg) == 32 && sizeof(ShapeMsg) == 32, "control messages are 32 bytes");
_Static_assert(sizeof(StatusMsg) == 32, "control messages are 32 bytes");

static int gPort = 48100, gMaxInflight = 2;
static BOOL gMirror, gNative, gBench, gNoLZ4, gH264, gBilinear;
static int gBitrateMbps = 40;  // H.264 target for motion (only when the link can't keep up)
static int gMaxQP = 24;        // H.264 quality floor for motion (lower = sharper, more data)
static int gMaxBenchHz;        // --bench N: frames per second (0 = the receiver's refresh rate)
static BOOL gAgent;            // the login agent (--agent), not a copy started from Finder or a terminal
static BOOL gInBundle;         // runs from USB-C Display.app rather than as the bare program
static BOOL gScreenPrompted;   // asked macOS for Screen Recording during this run

// ---- State shared by the capture callback, sender and reader threads ----
static pthread_mutex_t gLock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t gCond = PTHREAD_COND_INITIALIZER;
static CVPixelBufferRef gLatest;  // newest captured frame not yet sent (older ones are dropped)
static uint64_t gLatestNs;        // when it was on the Mac's screen (capture time)
static int gInflight;             // frames sent but not yet in the receiver's picture
static BOOL gConnected;
static int gCtl = -1, gFrm = -1;  // control and frame connections
static uint64_t gSendTime[256];
static uint32_t gSendLen[256];
static uint64_t gLastHeard;       // last message from the receiver; silence means the link died
static dispatch_queue_t gCtlQueue;  // every write to the control connection happens here
static size_t gChunk = 2880;      // linkSend piece: two TCP segments, one Thunderbolt frame
static double gLinkRate = 700e6;  // bytes/s the receiver takes in, measured from acks

// Pointer (HELLO_CURSOR): position polled at 1 kHz, shape at 60 Hz, both sent on the control
// connection the moment they change.
static BOOL gCursorMode, gInputMode;
static MouseMsg gMouse;
static NSData *gShape;            // ShapeMsg + pixels last sent
static CGDirectDisplayID gCursorDisplay;
static int gCursorOutW;           // picture width, to turn points into picture pixels
static dispatch_source_t gMouseTimer, gShapeTimer, gBeatTimer;
static uint64_t gStatFrames, gStatBytes, gStatRtt, gStatAcks, gStatReceiverUs, gStatCaptured, gStatH264;
// Where time goes on this side: shown on the Mac -> delivered to us, the Lanczos fit, and
// shown on the Mac -> its frame starting to go out (after diffing and compressing).
static uint64_t gStatDeliverNs, gStatFitNs, gStatToSendNs, gStatToSendN, gStatGpuNs;
static uint64_t gDumpSentAt;  // test card: when to save the picture as sent

// Exact pixels last sent losslessly, so only changed tiles are sent.
static uint8_t *gSent, *gMsg;
static size_t gMsgCap;
static int gW, gH;
// Per tile row: the rects it produced (built in parallel, then joined into gMsg).
typedef struct { uint8_t *buf, *stage, *scratch; size_t len; uint32_t rects; } RowOut;
static RowOut *gRows;
static int gRowCount;

// H.264 (only while the link can't keep up with exact pixels, or on request). Motion goes out
// as H.264; tiles that hold still are then resent exactly, and each H.264 frame names the
// blocks it changed so the receiver leaves the rest exact.
enum { MODE_LOSSLESS, MODE_MOTION };
static int gMode;
static BOOL gCanMotion, gForceMotion, gForceKey, gNoRefresh;
static VTCompressionSessionRef gEnc;
static dispatch_semaphore_t gEncDone;
static size_t gEncLen;            // Annex B bytes the last encode put after the frame + rect headers
static uint8_t *gPrevEnc;         // the frame last given to the encoder
static BOOL gPrevEncValid;
static RectHeader *gRegions;      // scratch for the changed-block list
static uint32_t gLastRegionBlocks;
// H.264 pictures replace the screen in 16x16 blocks (its macroblocks), so the
// softer H.264 version only shows right around what moves.
enum { BLOCK = 16 };
// Per tile: shown from H.264 since its last lossless update. A tile can change and change
// back (pointer passing over, hover, caret blink): it then equals gSent again but still
// shows the H.264 version, so the refresh has to resend it anyway.
static uint8_t *gLossy;
// Per tile: when it last changed. A lossy tile is made exact as soon as it has held still
// for SETTLE_NS, even while other parts of the screen keep moving.
static uint64_t *gTileChanged;
#define SETTLE_NS (80 * NSEC_PER_MSEC)

static uint64_t nowNs(void) { return clock_gettime_nsec_np(CLOCK_UPTIME_RAW); }

static uint64_t machToNs(uint64_t t) {
    static mach_timebase_info_data_t tb;
    if (!tb.denom) mach_timebase_info(&tb);
    return t * tb.numer / tb.denom;
}

// (Re)allocates the per-size buffers; returns YES when the size changed.
static BOOL ensureBuffers(int w, int h) {
    if (w == gW && h == gH) return NO;
    size_t px = (size_t)w * 4 * h;
    int tilesX = (w + TILE_W - 1) / TILE_W, rows = (h + TILE_H - 1) / TILE_H;
    size_t tiles = (size_t)tilesX * rows;
    size_t blocks = (size_t)((w + BLOCK - 1) / BLOCK) * ((h + BLOCK - 1) / BLOCK);
    free(gSent); free(gPrevEnc); free(gMsg); free(gRegions); free(gLossy); free(gTileChanged);
    for (int i = 0; i < gRowCount; i++) { free(gRows[i].buf); free(gRows[i].stage); free(gRows[i].scratch); }
    free(gRows);
    gSent = malloc(px);
    gPrevEnc = malloc(px);
    gRegions = malloc(blocks * sizeof(RectHeader));
    gLossy = calloc(tiles, 1);
    gTileChanged = calloc(tiles, sizeof(uint64_t));
    gMsgCap = sizeof(FrameHeader) + (tiles + blocks) * sizeof(RectHeader) + px + px / 64 + 4096;
    gMsg = malloc(gMsgCap);
    gRowCount = rows;
    gRows = calloc(rows, sizeof(RowOut));
    size_t scratch = compression_encode_scratch_buffer_size(COMPRESSION_LZ4_RAW);
    for (int i = 0; i < rows; i++) {
        gRows[i].buf = malloc((size_t)tilesX * sizeof(RectHeader) + (size_t)w * 4 * TILE_H + 256);
        gRows[i].stage = malloc((size_t)w * 4 * TILE_H);
        gRows[i].scratch = malloc(scratch);
    }
    gW = w;
    gH = h;
    gPrevEncValid = NO;
    return YES;
}

// ---- The link: never let TSO build a packet bigger than one Thunderbolt frame ----
// TCP_NOTSENT_LOWAT = 1 makes the socket writable only once everything written so far has
// left, so each tcp_output call has at most one piece (gChunk, two segments) to send.
static void configureLinkSocket(int fd) {
    int one = 1, mss = 0;
    socklen_t ml = sizeof mss;
    setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
    setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof one);
    if (setsockopt(fd, IPPROTO_TCP, TCP_NOTSENT_LOWAT, &one, sizeof one) != 0)
        printf("Warning: TCP_NOTSENT_LOWAT failed (%s); the link may wedge.\n", strerror(errno));
    struct timeval tv = { 1, 0 };
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof tv);
    int sndbuf = 4 << 20;
    setsockopt(fd, SOL_SOCKET, SO_SNDBUF, &sndbuf, sizeof sndbuf);
    // One Thunderbolt frame carries 4084 bytes: the Ethernet and IP/TCP headers plus as many
    // whole segments as fit (two at the usual 1440-byte MSS).
    if (getsockopt(fd, IPPROTO_TCP, TCP_MAXSEG, &mss, &ml) == 0 && mss > 0) {
        size_t segs = mss < 3990 ? 3990 / (size_t)mss : 1;
        gChunk = (segs ? segs : 1) * (size_t)mss;
    }
}

static BOOL linkSend(int fd, const void *buf, size_t n) {
    const uint8_t *p = buf;
    while (n) {
        ssize_t k = send(fd, p, n < gChunk ? n : gChunk, 0);
        if (k < 0 && (errno == EINTR || errno == EAGAIN)) k = 0;
        else if (k <= 0) return NO;
        p += k;
        n -= (size_t)k;
        struct pollfd pf = { fd, POLLOUT, 0 };
        uint64_t start = nowNs();
        for (;;) {
            int r = poll(&pf, 1, 100);
            if (r > 0) {
                if (pf.revents & (POLLERR | POLLHUP | POLLNVAL)) return NO;
                break;
            }
            if (r < 0 && errno != EINTR) return NO;
            if (!gConnected || nowNs() - start > 2 * NSEC_PER_SEC) return NO;  // link stalled
        }
    }
    return YES;
}

static BOOL recvAll(int fd, void *buf, size_t n) {
    uint8_t *p = buf;
    while (n) {
        ssize_t k = recv(fd, p, n, 0);
        if (k < 0 && errno == EINTR) continue;
        if (k <= 0) return NO;
        p += k; n -= (size_t)k;
    }
    return YES;
}

static void endSession(void) {
    pthread_mutex_lock(&gLock);
    gConnected = NO;
    if (gCtl >= 0) shutdown(gCtl, SHUT_RDWR);
    if (gFrm >= 0) shutdown(gFrm, SHUT_RDWR);
    pthread_cond_broadcast(&gCond);
    pthread_mutex_unlock(&gLock);
}

// Control writes all go through gCtlQueue, one at a time.
static void ctlSend(const void *msg, size_t len) {
    if (!gConnected || gCtl < 0) return;
    if (!linkSend(gCtl, msg, len)) endSession();
}

// ---- Fitting a Retina picture to the laptop panel ----
// ScreenCaptureKit's own scaling is bilinear, which leaves small text a little soft. Instead
// the display is captured at its full pixel size and shrunk on the GPU with a Lanczos filter.
static id<MTLDevice> gMtl;
static id<MTLCommandQueue> gMtlQueue;
static CVMetalTextureCacheRef gTexCache;
static MPSImageLanczosScale *gLanczos;
static CVPixelBufferPoolRef gScaledPool;
static int gScaleW, gScaleH;   // 0: no scaling (capture at the picture size)
static BOOL gScaleCPU = YES;   // vImage instead of Metal (--gpu-fit for Metal)

static BOOL setupScaler(int outW, int outH) {
    if (!gMtl) {
        gMtl = MTLCreateSystemDefaultDevice();
        if (!gMtl) return NO;
        gMtlQueue = [gMtl newCommandQueue];
        if (CVMetalTextureCacheCreate(NULL, NULL, gMtl, NULL, &gTexCache) != kCVReturnSuccess) { gMtl = nil; return NO; }
        gLanczos = [[MPSImageLanczosScale alloc] initWithDevice:gMtl];
    }
    if (gScaledPool) { CVPixelBufferPoolRelease(gScaledPool); gScaledPool = NULL; }
    NSDictionary *attrs = @{ (id)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA),
                             (id)kCVPixelBufferWidthKey: @(outW), (id)kCVPixelBufferHeightKey: @(outH),
                             (id)kCVPixelBufferIOSurfacePropertiesKey: @{}, (id)kCVPixelBufferMetalCompatibilityKey: @YES };
    if (CVPixelBufferPoolCreate(NULL, NULL, (__bridge CFDictionaryRef)attrs, &gScaledPool) != kCVReturnSuccess) return NO;
    gScaleW = outW;
    gScaleH = outH;
    return YES;
}

// The same Lanczos filter on the CPU cores (vImage): the GPU took ~6 ms for this, apparently
// not clocking up for one small job per frame.

// vImage scales on one core; the picture is cut into horizontal strips scaled in parallel.
// When q source rows become exactly p output rows (8 -> 5 for "looks like 1536x960"), a strip
// that starts on such a boundary samples exactly where the whole-image scale would; each strip
// reads a few extra source rows on either side, whose output rows are thrown away.
enum { SCALE_STRIPS = 16 };
static uint8_t *gStripOut[SCALE_STRIPS], *gStripTemp[SCALE_STRIPS];
static size_t gStripOutSize, gStripTempSize;

static int gcdInt(int a, int b) { while (b) { int t = a % b; a = b; b = t; } return a; }

static CVPixelBufferRef scaleFrameCPU(CVPixelBufferRef src) {
    CVPixelBufferRef dst = NULL;
    if (CVPixelBufferPoolCreatePixelBuffer(NULL, gScaledPool, &dst) != kCVReturnSuccess) return NULL;
    CVPixelBufferLockBaseAddress(src, kCVPixelBufferLock_ReadOnly);
    CVPixelBufferLockBaseAddress(dst, 0);
    uint8_t *sBase = CVPixelBufferGetBaseAddress(src), *dBase = CVPixelBufferGetBaseAddress(dst);
    size_t sStride = CVPixelBufferGetBytesPerRow(src), dStride = CVPixelBufferGetBytesPerRow(dst);
    int sw = (int)CVPixelBufferGetWidth(src), sh = (int)CVPixelBufferGetHeight(src);
    int dw = (int)CVPixelBufferGetWidth(dst), dh = (int)CVPixelBufferGetHeight(dst);
    int g = gcdInt(sh, dh), p = dh / g, q = sh / g;
    __block BOOL failed = NO;
    if (p > 64) {  // no small exact ratio: the whole picture at once
        vImage_Buffer s = { sBase, sh, sw, sStride }, d = { dBase, dh, dw, dStride };
        failed = vImageScale_ARGB8888(&s, &d, NULL, kvImageDoNotTile) != kvImageNoError;
    } else {
        int units = dh / p, per = (units + SCALE_STRIPS - 1) / SCALE_STRIPS, margin = (10 + q - 1) / q;
        size_t outNeed = (size_t)dw * 4 * (per + 2 * margin) * p;
        if (outNeed > gStripOutSize) {
            for (int i = 0; i < SCALE_STRIPS; i++) { free(gStripOut[i]); gStripOut[i] = malloc(outNeed); }
            gStripOutSize = outNeed;
        }
        vImage_Buffer probeS = { sBase, (vImagePixelCount)((per + 2 * margin) * q), sw, sStride };
        vImage_Buffer probeD = { gStripOut[0], (vImagePixelCount)((per + 2 * margin) * p), dw, (size_t)dw * 4 };
        vImage_Error need = vImageScale_ARGB8888(&probeS, &probeD, NULL, kvImageGetTempBufferSize | kvImageDoNotTile);
        if (need > 0 && (size_t)need > gStripTempSize) {
            for (int i = 0; i < SCALE_STRIPS; i++) { free(gStripTemp[i]); gStripTemp[i] = malloc((size_t)need); }
            gStripTempSize = (size_t)need;
        }
        dispatch_apply(SCALE_STRIPS, DISPATCH_APPLY_AUTO, ^(size_t k) {
            int u0 = (int)k * per, u1 = MIN(units, u0 + per);
            if (u0 >= u1) return;
            int m0 = MIN(margin, u0), m1 = MIN(margin, units - u1);
            vImage_Buffer s = { sBase + (size_t)(u0 - m0) * q * sStride, (vImagePixelCount)((u1 - u0 + m0 + m1) * q), sw, sStride };
            vImage_Buffer d = { gStripOut[k], (vImagePixelCount)((u1 - u0 + m0 + m1) * p), dw, (size_t)dw * 4 };
            if (vImageScale_ARGB8888(&s, &d, gStripTemp[k], kvImageDoNotTile) != kvImageNoError) { failed = YES; return; }
            for (int y = 0; y < (u1 - u0) * p; y++)
                memcpy(dBase + (size_t)(u0 * p + y) * dStride, gStripOut[k] + (size_t)(m0 * p + y) * dw * 4, (size_t)dw * 4);
        });
    }
    CVPixelBufferUnlockBaseAddress(dst, 0);
    CVPixelBufferUnlockBaseAddress(src, kCVPixelBufferLock_ReadOnly);
    if (failed) { CVPixelBufferRelease(dst); return NULL; }
    return dst;
}

// The captured frame shrunk to gScaleW x gScaleH (+1 retained), or NULL.
static CVPixelBufferRef scaleFrame(CVPixelBufferRef src) {
    if (gScaleCPU) return scaleFrameCPU(src);
    CVPixelBufferRef dst = NULL;
    if (CVPixelBufferPoolCreatePixelBuffer(NULL, gScaledPool, &dst) != kCVReturnSuccess) return NULL;
    NSDictionary *usage = @{ (id)kCVMetalTextureUsage: @(MTLTextureUsageShaderRead | MTLTextureUsageShaderWrite) };
    CVMetalTextureRef st = NULL, dt = NULL;
    CVMetalTextureCacheCreateTextureFromImage(NULL, gTexCache, src, (__bridge CFDictionaryRef)usage, MTLPixelFormatBGRA8Unorm,
                                              CVPixelBufferGetWidth(src), CVPixelBufferGetHeight(src), 0, &st);
    CVMetalTextureCacheCreateTextureFromImage(NULL, gTexCache, dst, (__bridge CFDictionaryRef)usage, MTLPixelFormatBGRA8Unorm,
                                              gScaleW, gScaleH, 0, &dt);
    if (!st || !dt) {
        if (st) CFRelease(st);
        if (dt) CFRelease(dt);
        CVPixelBufferRelease(dst);
        return NULL;
    }
    id<MTLCommandBuffer> cb = [gMtlQueue commandBuffer];
    [gLanczos encodeToCommandBuffer:cb sourceTexture:CVMetalTextureGetTexture(st) destinationTexture:CVMetalTextureGetTexture(dt)];
    [cb commit];
    [cb waitUntilCompleted];
    gStatGpuNs += (uint64_t)((cb.GPUEndTime - cb.GPUStartTime) * 1e9);
    CFRelease(st);
    CFRelease(dt);
    return dst;
}

// ---- Capture ----
@interface Capture : NSObject <SCStreamOutput, SCStreamDelegate>
@end
@implementation Capture
- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sb ofType:(SCStreamOutputType)type {
    if (type != SCStreamOutputTypeScreen) return;
    CFArrayRef atts = CMSampleBufferGetSampleAttachmentsArray(sb, false);
    if (!atts || CFArrayGetCount(atts) == 0) return;
    NSDictionary *info = (__bridge NSDictionary *)CFArrayGetValueAtIndex(atts, 0);
    if ([info[SCStreamFrameInfoStatus] integerValue] != SCFrameStatusComplete) return;
    CVPixelBufferRef pb = CMSampleBufferGetImageBuffer(sb);
    if (!pb) return;
    NSNumber *shown = info[SCStreamFrameInfoDisplayTime];  // mach time it was on screen
    uint64_t t = shown ? machToNs(shown.unsignedLongLongValue) : nowNs(), arrived = nowNs();
    if (gScaleW && (int)CVPixelBufferGetWidth(pb) != gScaleW) {
        pb = scaleFrame(pb);
        if (!pb) return;
    } else {
        CVPixelBufferRetain(pb);
    }
    uint64_t fitted = nowNs();
    pthread_mutex_lock(&gLock);
    if (gLatest) CVPixelBufferRelease(gLatest);
    gLatest = pb;
    gLatestNs = t;
    gStatCaptured++;
    if (arrived > t) gStatDeliverNs += arrived - t;
    gStatFitNs += fitted - arrived;
    pthread_cond_broadcast(&gCond);
    pthread_mutex_unlock(&gLock);
}
- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
    fprintf(stderr, "Capture stopped: %s\n", error.localizedDescription.UTF8String);
    endSession();
}
@end

// ---- Exact frames: diff against what the receiver shows, emit changed tile runs ----
// One tile row of the frame: dirty tiles become runs (RectHeader + LZ4 or raw pixels) in
// row->buf. Rows are independent, so they're built in parallel.
// settledBefore (motion mode): leave out tiles that changed after this time; they're still
// moving and stay H.264 for now.
static void buildRow(int ri, const uint8_t *src, size_t stride, int w, int h, BOOL full, uint64_t settledBefore, BOOL lz4) {
    RowOut *row = &gRows[ri];
    row->len = 0;
    row->rects = 0;
    int ty = ri * TILE_H, th = MIN(TILE_H, h - ty), tilesX = (w + TILE_W - 1) / TILE_W;
    size_t rowBytes = (size_t)w * 4;
    uint8_t *lossy = gLossy + (size_t)ri * tilesX;
    uint64_t *changed = gTileChanged + (size_t)ri * tilesX;
    BOOL dirty[256];
    for (int tx = 0; tx < tilesX; tx++) {
        if (settledBefore && changed[tx] > settledBefore) { dirty[tx] = NO; continue; }
        BOOL d = full || lossy[tx];
        int x = tx * TILE_W, tw = MIN(TILE_W, w - x);
        for (int r = 0; r < th && !d; r++)
            d = memcmp(src + (ty + r) * stride + x * 4, gSent + (ty + r) * rowBytes + x * 4, tw * 4) != 0;
        dirty[tx] = d;
        if (d) lossy[tx] = 0;  // everything dirty goes out losslessly below
    }
    uint8_t *out = row->buf;
    for (int tx = 0; tx < tilesX;) {
        if (!dirty[tx]) { tx++; continue; }
        int t0 = tx;
        while (tx < tilesX && dirty[tx]) tx++;
        int x = t0 * TILE_W, rw = MIN(tx * TILE_W, w) - x;
        size_t runBytes = (size_t)rw * 4, n = runBytes * th;
        RectHeader *rh = (RectHeader *)out;
        out += sizeof *rh;
        // The run's rows, packed: they become the new reference (gSent) and what's sent.
        uint8_t *stage = lz4 ? row->stage : out;
        for (int r = 0; r < th; r++) {
            const uint8_t *s = src + (ty + r) * stride + x * 4;
            memcpy(gSent + (ty + r) * rowBytes + x * 4, s, runBytes);
            memcpy(stage + r * runBytes, s, runBytes);
        }
        *rh = (RectHeader){ (uint16_t)x, (uint16_t)ty, (uint16_t)rw, (uint16_t)th, ENC_RAW, (uint32_t)n };
        if (lz4) {
            // Worth it only if it saves at least an eighth: decoding costs the receiver time too.
            size_t c = compression_encode_buffer(out, n - n / 8, stage, n, row->scratch, COMPRESSION_LZ4_RAW);
            if (c) {
                rh->encoding = ENC_LZ4;
                rh->dataBytes = (uint32_t)c;
            } else {
                memcpy(out, stage, n);
            }
        }
        out += rh->dataBytes;
        row->rects++;
    }
    row->len = (size_t)(out - row->buf);
}

static size_t buildFrame(CVPixelBufferRef pb, uint32_t seq, BOOL *full, uint64_t settledBefore, uint64_t captureNs) {
    CVPixelBufferLockBaseAddress(pb, kCVPixelBufferLock_ReadOnly);
    int w = (int)CVPixelBufferGetWidth(pb), h = (int)CVPixelBufferGetHeight(pb);
    size_t stride = CVPixelBufferGetBytesPerRow(pb);
    const uint8_t *src = CVPixelBufferGetBaseAddress(pb);
    if (ensureBuffers(w, h)) *full = YES;
    BOOL fullNow = *full, lz4 = !gNoLZ4;
    dispatch_apply((size_t)gRowCount, DISPATCH_APPLY_AUTO, ^(size_t ri) {
        buildRow((int)ri, src, stride, w, h, fullNow, settledBefore, lz4);
    });
    *full = NO;
    CVPixelBufferUnlockBaseAddress(pb, kCVPixelBufferLock_ReadOnly);
    uint8_t *out = gMsg + sizeof(FrameHeader);
    uint32_t rects = 0;
    for (int i = 0; i < gRowCount; i++) {
        memcpy(out, gRows[i].buf, gRows[i].len);
        out += gRows[i].len;
        rects += gRows[i].rects;
    }
    if (!rects) return 0;
    *(FrameHeader *)gMsg = (FrameHeader){ MAGIC_FRAME, seq, (uint16_t)w, (uint16_t)h, rects,
                                          (uint32_t)(out - gMsg - sizeof(FrameHeader)), 0, captureNs };
    return (size_t)(out - gMsg);
}

// ---- H.264: hardware encoder in low-latency mode, no B-frames, one frame in one out ----
static void encoded(void *refcon, void *frameRefcon, OSStatus status, VTEncodeInfoFlags flags, CMSampleBufferRef sb) {
    gEncLen = 0;
    if (status == noErr && sb && !(flags & kVTEncodeInfo_FrameDropped)) {
        static const uint8_t startCode[4] = {0, 0, 0, 1};
        uint8_t *out = gMsg + sizeof(FrameHeader) + sizeof(RectHeader), *end = gMsg + gMsgCap;
        CFArrayRef atts = CMSampleBufferGetSampleAttachmentsArray(sb, false);
        BOOL key = !(atts && CFArrayGetCount(atts) &&
                     CFDictionaryContainsKey(CFArrayGetValueAtIndex(atts, 0), kCMSampleAttachmentKey_NotSync));
        size_t n = 0;
        if (key) {  // repeat SPS/PPS so the decoder can (re)start at any keyframe
            CMFormatDescriptionRef fd = CMSampleBufferGetFormatDescription(sb);
            size_t count = 0;
            CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fd, 0, NULL, NULL, &count, NULL);
            for (size_t i = 0; i < count; i++) {
                const uint8_t *ps;
                size_t len;
                if (CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fd, i, &ps, &len, NULL, NULL) != noErr) continue;
                memcpy(out + n, startCode, 4);
                memcpy(out + n + 4, ps, len);
                n += 4 + len;
            }
        }
        // AVCC (4-byte big-endian NAL lengths) to Annex B (start codes) in place: same size.
        CMBlockBufferRef bb = CMSampleBufferGetDataBuffer(sb);
        size_t total = CMBlockBufferGetDataLength(bb);
        if (out + n + total <= end && CMBlockBufferCopyDataBytes(bb, 0, total, out + n) == kCMBlockBufferNoErr) {
            uint8_t *p = out + n, *stop = p + total;
            while (p + 4 <= stop) {
                uint32_t len = (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3];
                memcpy(p, startCode, 4);
                p += 4 + len;
            }
            gEncLen = n + total;
        }
    }
    dispatch_semaphore_signal(gEncDone);
}

static BOOL createEncoder(int w, int h, int hz) {
    NSDictionary *spec = @{(__bridge NSString *)kVTVideoEncoderSpecification_EnableLowLatencyRateControl: @YES};
    OSStatus st = VTCompressionSessionCreate(NULL, w, h, kCMVideoCodecType_H264, (__bridge CFDictionaryRef)spec,
                                             NULL, NULL, encoded, NULL, &gEnc);
    if (st != noErr) {
        fprintf(stderr, "Low-latency H.264 unavailable (%d); using the regular encoder.\n", (int)st);
        st = VTCompressionSessionCreate(NULL, w, h, kCMVideoCodecType_H264, NULL, NULL, NULL, encoded, NULL, &gEnc);
        if (st != noErr) { gEnc = NULL; return NO; }
    }
    VTSessionSetProperty(gEnc, kVTCompressionPropertyKey_RealTime, kCFBooleanTrue);
    VTSessionSetProperty(gEnc, kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse);
    // Low-latency mode marks frames as long-term references by default; Windows' H.264
    // decoder rejects every P-frame that manages them, so turn that off.
    OSStatus ltr = VTSessionSetProperty(gEnc, kVTCompressionPropertyKey_EnableLTR, kCFBooleanFalse);
    if (ltr != noErr) fprintf(stderr, "Could not turn off long-term references (%d).\n", (int)ltr);
    // Never let moving content get coarser than this, even if a frame overshoots the
    // bitrate: rate control alone leaves ringing around edges that move.
    OSStatus qp = VTSessionSetProperty(gEnc, kVTCompressionPropertyKey_MaxAllowedFrameQP, (__bridge CFNumberRef)@(gMaxQP));
    if (qp != noErr) fprintf(stderr, "Could not set the H.264 quality floor (%d).\n", (int)qp);
    VTSessionSetProperty(gEnc, kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_ConstrainedHigh_AutoLevel);
    VTSessionSetProperty(gEnc, kVTCompressionPropertyKey_AverageBitRate, (__bridge CFNumberRef)@(gBitrateMbps * 1000000));
    VTSessionSetProperty(gEnc, kVTCompressionPropertyKey_ExpectedFrameRate, (__bridge CFNumberRef)@(hz));
    VTSessionSetProperty(gEnc, kVTCompressionPropertyKey_MaxKeyFrameInterval, (__bridge CFNumberRef)@(100000));
    // Same primaries and transfer curve as the sRGB captures, so VideoToolbox doesn't convert
    // them: with a BT.709 curve here, midtones came out ~11 levels darker than the exact
    // lossless tiles next to them (the receiver turns YUV straight back into RGB).
    VTSessionSetProperty(gEnc, kVTCompressionPropertyKey_ColorPrimaries, kCVImageBufferColorPrimaries_ITU_R_709_2);
    VTSessionSetProperty(gEnc, kVTCompressionPropertyKey_TransferFunction, kCVImageBufferTransferFunction_sRGB);
    VTSessionSetProperty(gEnc, kVTCompressionPropertyKey_YCbCrMatrix, kCVImageBufferYCbCrMatrix_ITU_R_709_2);
    VTCompressionSessionPrepareToEncodeFrames(gEnc);
    gEncDone = dispatch_semaphore_create(0);
    return YES;
}

static void destroyEncoder(void) {
    if (!gEnc) return;
    VTCompressionSessionInvalidate(gEnc);
    CFRelease(gEnc);
    gEnc = NULL;
}

// Whether any tile shown from H.264 has held still since `before` and can be made exact.
static BOOL settledLossyTiles(uint64_t before) {
    if (!gLossy) return NO;
    size_t tiles = (size_t)((gW + TILE_W - 1) / TILE_W) * ((gH + TILE_H - 1) / TILE_H);
    for (size_t i = 0; i < tiles; i++)
        if (gLossy[i] && gTileChanged[i] <= before) return YES;
    return NO;
}

// Lists the 16x16 block runs that differ from the frame last given to the encoder (all of
// them when `all`), and makes that frame the new reference. Returns the number of regions.
static uint32_t changedRegions(CVPixelBufferRef pb, BOOL all) {
    CVPixelBufferLockBaseAddress(pb, kCVPixelBufferLock_ReadOnly);
    int w = gW, h = gH, tilesX = (w + TILE_W - 1) / TILE_W, blocksX = (w + BLOCK - 1) / BLOCK;
    size_t stride = CVPixelBufferGetBytesPerRow(pb), rowBytes = (size_t)w * 4;
    const uint8_t *src = CVPixelBufferGetBaseAddress(pb);
    uint32_t n = 0, blocks = 0;
    uint64_t now = nowNs();
    BOOL dirty[blocksX];
    for (int by = 0; by < h; by += BLOCK) {
        int bh = MIN(BLOCK, h - by);
        uint8_t *lossy = gLossy + (by / TILE_H) * tilesX;
        uint64_t *changed = gTileChanged + (by / TILE_H) * tilesX;
        for (int bx = 0; bx < blocksX; bx++) {
            BOOL d = all;
            int x = bx * BLOCK, bw = MIN(BLOCK, w - x);
            for (int r = 0; r < bh && !d; r++)
                d = memcmp(src + (by + r) * stride + x * 4, gPrevEnc + (by + r) * rowBytes + x * 4, bw * 4) != 0;
            dirty[bx] = d;
            if (d) {
                lossy[x / TILE_W] = 1;  // the receiver shows H.264 here until this tile settles
                changed[x / TILE_W] = now;
                blocks++;
            }
        }
        for (int bx = 0; bx < blocksX;) {
            if (!dirty[bx]) { bx++; continue; }
            int b0 = bx;
            while (bx < blocksX && dirty[bx]) bx++;
            int x = b0 * BLOCK, rw = MIN(bx * BLOCK, w) - x;
            for (int r = 0; r < bh; r++)
                memcpy(gPrevEnc + (by + r) * rowBytes + x * 4, src + (by + r) * stride + x * 4, (size_t)rw * 4);
            gRegions[n++] = (RectHeader){ (uint16_t)x, (uint16_t)by, (uint16_t)rw, (uint16_t)bh, ENC_REGION, 0 };
        }
    }
    CVPixelBufferUnlockBaseAddress(pb, kCVPixelBufferLock_ReadOnly);
    gPrevEncValid = YES;
    gLastRegionBlocks = blocks;
    return n;
}

// Encodes one frame into gMsg as a full-frame H.264 rect followed by the regions it
// changed (none for a keyframe: the receiver then shows all of it). Returns the length.
static size_t encodeFrame(CVPixelBufferRef pb, uint32_t seq, BOOL key, uint64_t captureNs) {
    int w = (int)CVPixelBufferGetWidth(pb), h = (int)CVPixelBufferGetHeight(pb);
    if (ensureBuffers(w, h) || !gPrevEncValid) key = YES;
    uint32_t regions = changedRegions(pb, key);
    if (!key && regions == 0) return 0;  // nothing on screen changed
    NSDictionary *opts = key ? @{(__bridge NSString *)kVTEncodeFrameOptionKey_ForceKeyFrame: @YES} : nil;
    gEncLen = 0;
    CMTime pts = CMTimeMake((int64_t)(nowNs() / 1000), 1000000);
    if (VTCompressionSessionEncodeFrame(gEnc, pb, pts, kCMTimeInvalid, (__bridge CFDictionaryRef)opts, NULL, NULL) != noErr)
        return 0;
    if (dispatch_semaphore_wait(gEncDone, dispatch_time(DISPATCH_TIME_NOW, 200 * NSEC_PER_MSEC)) != 0) {
        VTCompressionSessionCompleteFrames(gEnc, kCMTimeInvalid);
        dispatch_semaphore_wait(gEncDone, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC));
    }
    if (!gEncLen) {
        gPrevEncValid = NO;  // the receiver never got this frame: start over with a keyframe
        return 0;
    }
    size_t len = sizeof(FrameHeader) + sizeof(RectHeader) + gEncLen;
    if (key || len + regions * sizeof(RectHeader) > gMsgCap) {
        regions = 0;  // the receiver shows the whole picture: every tile is now H.264
        memset(gLossy, 1, (size_t)((gW + TILE_W - 1) / TILE_W) * ((gH + TILE_H - 1) / TILE_H));
    }
    memcpy(gMsg + len, gRegions, regions * sizeof(RectHeader));
    len += regions * sizeof(RectHeader);
    *(FrameHeader *)gMsg = (FrameHeader){ MAGIC_FRAME, seq, (uint16_t)w, (uint16_t)h, 1 + regions,
                                          (uint32_t)(len - sizeof(FrameHeader)), FRAME_HAS_H264, captureNs };
    *(RectHeader *)(gMsg + sizeof(FrameHeader)) = (RectHeader){ 0, 0, (uint16_t)w, (uint16_t)h, ENC_H264, (uint32_t)gEncLen };
    return len;
}

// ---- Pointer: position at 1 kHz, shape at 60 Hz, on the control connection ----
static void pollMouse(void) {  // on gCtlQueue
    uint64_t t = nowNs();
    CGEventRef e = CGEventCreate(NULL);
    CGPoint p = CGEventGetLocation(e);  // global points, top-left origin, like CGDisplayBounds
    CFRelease(e);
    CGRect b = CGDisplayBounds(gCursorDisplay);
    // On this display at all, and shown (macOS hides the pointer while you type, until the
    // mouse moves). The picture pixel is the one the point falls in, so a point the laptop
    // put at a pixel's centre reads back as that same pixel.
    BOOL onDisplay = CGRectContainsPoint(b, p), visible = onDisplay && CGCursorIsVisible();
    double scale = gCursorOutW / b.size.width;
    int16_t x = onDisplay ? (int16_t)floor((p.x - b.origin.x) * scale) : 0;
    int16_t y = onDisplay ? (int16_t)floor((p.y - b.origin.y) * scale) : 0;
    if (gMouse.visible == visible && gMouse.reserved == onDisplay && gMouse.x == x && gMouse.y == y) return;
    gMouse = (MouseMsg){ MAGIC_MOUSE, x, y, (uint16_t)visible, (uint16_t)onDisplay, t, {0} };
    MouseMsg m = gMouse;
    ctlSend(&m, sizeof m);
}

// Where the other displays touch this one, in picture pixels: the laptop's pointer crosses
// there. Spans along the left, right, top and bottom edges (start == end: none).
static uint64_t gLayoutA, gLayoutB;

static void sendLayout(BOOL force) {
    CGDirectDisplayID ids[16];
    uint32_t n = 0;
    if (CGGetActiveDisplayList(16, ids, &n) != kCGErrorSuccess) return;
    CGRect b = CGDisplayBounds(gCursorDisplay);
    double s = gCursorOutW / b.size.width;  // picture pixels per point
    double lo[4] = { 1e9, 1e9, 1e9, 1e9 }, hi[4] = { -1e9, -1e9, -1e9, -1e9 };
    for (uint32_t i = 0; i < n; i++) {
        if (ids[i] == gCursorDisplay || CGDisplayMirrorsDisplay(ids[i]) != kCGNullDirectDisplay) continue;
        CGRect d = CGDisplayBounds(ids[i]);
        double y0 = MAX(CGRectGetMinY(d), CGRectGetMinY(b)), y1 = MIN(CGRectGetMaxY(d), CGRectGetMaxY(b));
        double x0 = MAX(CGRectGetMinX(d), CGRectGetMinX(b)), x1 = MIN(CGRectGetMaxX(d), CGRectGetMaxX(b));
        int e = -1;
        if (fabs(CGRectGetMaxX(d) - CGRectGetMinX(b)) < 1 && y1 > y0) e = 0;       // left
        else if (fabs(CGRectGetMinX(d) - CGRectGetMaxX(b)) < 1 && y1 > y0) e = 1;  // right
        else if (fabs(CGRectGetMaxY(d) - CGRectGetMinY(b)) < 1 && x1 > x0) e = 2;  // top
        else if (fabs(CGRectGetMinY(d) - CGRectGetMaxY(b)) < 1 && x1 > x0) e = 3;  // bottom
        if (e < 0) continue;
        double a0 = e < 2 ? (y0 - CGRectGetMinY(b)) * s : (x0 - CGRectGetMinX(b)) * s;
        double a1 = e < 2 ? (y1 - CGRectGetMinY(b)) * s : (x1 - CGRectGetMinX(b)) * s;
        lo[e] = MIN(lo[e], a0);
        hi[e] = MAX(hi[e], a1);
    }
    uint16_t span[8] = { 0 };
    for (int e = 0; e < 4; e++)
        if (hi[e] > lo[e]) { span[e * 2] = (uint16_t)floor(lo[e]); span[e * 2 + 1] = (uint16_t)ceil(hi[e]); }
    uint64_t a, bb;
    memcpy(&a, span, 8);
    memcpy(&bb, span + 4, 8);
    if (!force && a == gLayoutA && bb == gLayoutB) return;
    gLayoutA = a;
    gLayoutB = bb;
    CtlMsg m = { MAGIC_LAYOUT, 0, a, bb, {0} };
    ctlSend(&m, sizeof m);
}

// Main thread: renders the current system pointer at picture scale; sends it if it changed.
// The window server's cursor seed changes whenever the pointer does, so nothing is drawn
// while it stays the same (drawing it 60 times a second slowed the main thread).
static void pollShape(void) {
    static int (*cursorSeed)(void);
    static BOOL looked;
    static int lastSeed = -1;
    if (!looked) {
        looked = YES;
        cursorSeed = (int (*)(void))dlsym(RTLD_DEFAULT, "CGSCurrentCursorSeed");
    }
    if (cursorSeed && gShape) {
        int seed = cursorSeed();
        if (seed == lastSeed) return;
        lastSeed = seed;
    }
    NSCursor *cursor = NSCursor.currentSystemCursor;
    NSImage *image = cursor.image;
    if (!image || image.size.width <= 0) return;
    double scale = gCursorOutW / CGDisplayBounds(gCursorDisplay).size.width;
    int w = (int)ceil(image.size.width * scale), h = (int)ceil(image.size.height * scale);
    if (w <= 0 || h <= 0 || w > 256 || h > 256) return;
    NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:w pixelsHigh:h
        bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace
        bytesPerRow:w * 4 bitsPerPixel:32];
    [NSGraphicsContext saveGraphicsState];
    NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
    NSGraphicsContext.currentContext.imageInterpolation = NSImageInterpolationHigh;
    [image drawInRect:NSMakeRect(0, 0, w, h) fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1];
    [NSGraphicsContext restoreGraphicsState];

    size_t len = sizeof(ShapeMsg) + (size_t)w * h * 4;
    NSMutableData *msg = [NSMutableData dataWithLength:len];
    uint8_t *px = (uint8_t *)msg.mutableBytes + sizeof(ShapeMsg);
    const uint8_t *src = rep.bitmapData;  // premultiplied RGBA; Windows cursors want straight BGRA
    for (int i = 0; i < w * h; i++) {
        uint8_t r = src[i * 4], g = src[i * 4 + 1], bl = src[i * 4 + 2], a = src[i * 4 + 3];
        px[i * 4] = a ? (uint8_t)MIN(255, bl * 255 / a) : 0;
        px[i * 4 + 1] = a ? (uint8_t)MIN(255, g * 255 / a) : 0;
        px[i * 4 + 2] = a ? (uint8_t)MIN(255, r * 255 / a) : 0;
        px[i * 4 + 3] = a;
    }
    NSPoint hot = cursor.hotSpot;  // from the image's top-left, in points
    *(ShapeMsg *)msg.mutableBytes = (ShapeMsg){ MAGIC_SHAPE, (uint16_t)w, (uint16_t)h,
        (uint16_t)MIN(w - 1, lround(hot.x * scale)), (uint16_t)MIN(h - 1, lround(hot.y * scale)), (uint32_t)(w * h * 4), {0} };
    if ([gShape isEqualToData:msg]) return;  // same pointer as before
    gShape = msg;
    dispatch_async(gCtlQueue, ^{ ctlSend(msg.bytes, msg.length); });
}

static void startPointer(CGDirectDisplayID did, int outW) {
    gCursorDisplay = did;
    gCursorOutW = outW;
    gMouse = (MouseMsg){ MAGIC_MOUSE, 0, 0, 0xFFFF, 0, 0, {0} };  // force a first update
    gShape = nil;
    gMouseTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, gCtlQueue);
    dispatch_source_set_timer(gMouseTimer, DISPATCH_TIME_NOW, NSEC_PER_MSEC, 100 * NSEC_PER_USEC);
    dispatch_source_set_event_handler(gMouseTimer, ^{ pollMouse(); });
    dispatch_resume(gMouseTimer);
    gShapeTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(gShapeTimer, DISPATCH_TIME_NOW, NSEC_PER_SEC / 60, NSEC_PER_MSEC * 2);
    dispatch_source_set_event_handler(gShapeTimer, ^{ pollShape(); });
    dispatch_resume(gShapeTimer);
}

static void stopTimers(void) {
    if (gMouseTimer) { dispatch_source_cancel(gMouseTimer); gMouseTimer = nil; }
    if (gShapeTimer) { dispatch_source_cancel(gShapeTimer); gShapeTimer = nil; }
    if (gBeatTimer) { dispatch_source_cancel(gBeatTimer); gBeatTimer = nil; }
}

// ---- Frames ----
static void *senderThread(void *arg) {
    pthread_set_qos_class_self_np(QOS_CLASS_USER_INTERACTIVE, 0);
    uint32_t seq = 0;
    BOOL full = YES;
    gW = gH = 0;
    int heavy = 0, calm = 0;
    uint64_t lastNew = nowNs();
    // The frame last captured: tiles of it shown from H.264 that have held still are resent
    // exactly in the gaps between new frames, even while other parts of the screen move.
    CVPixelBufferRef still = NULL;
    uint64_t stillNs = 0;
    for (;;) {
        CVPixelBufferRef pb = NULL;
        uint64_t capNs = 0;
        BOOL refresh = NO;
        pthread_mutex_lock(&gLock);
        while (gConnected) {
            uint64_t now = nowNs();
            // Settled tiles go first: during steady motion a new frame is nearly always
            // waiting, and they'd otherwise wait until everything stops.
            if (gInflight < gMaxInflight && still && !gNoRefresh && settledLossyTiles(now - SETTLE_NS)) {
                pb = CVPixelBufferRetain(still);
                capNs = stillNs;
                refresh = YES;
                break;
            }
            if (gLatest && gInflight < gMaxInflight) {
                pb = gLatest;
                capNs = gLatestNs;
                gLatest = NULL;
                pthread_cond_broadcast(&gCond);  // room for the next frame (--bench waits on this)
                break;
            }
            if (gMode == MODE_MOTION && !gForceMotion && now - lastNew > 250 * NSEC_PER_MSEC) {
                gMode = MODE_LOSSLESS;  // motion stopped; settled tiles become exact as usual
                calm = 0;
            }
            struct timespec ts;
            clock_gettime(CLOCK_REALTIME, &ts);
            ts.tv_nsec += (still && !gNoRefresh && settledLossyTiles(UINT64_MAX) ? 20 : 250) * NSEC_PER_MSEC;
            if (ts.tv_nsec >= (long)NSEC_PER_SEC) { ts.tv_sec++; ts.tv_nsec -= NSEC_PER_SEC; }
            pthread_cond_timedwait(&gCond, &gLock, &ts);
        }
        BOOL key = gForceKey || !gPrevEncValid;
        BOOL motion = gMode == MODE_MOTION && !refresh;
        if (pb && motion) gForceKey = NO;
        if (!gConnected) {
            pthread_mutex_unlock(&gLock);
            if (pb) CVPixelBufferRelease(pb);
            break;
        }
        pthread_mutex_unlock(&gLock);

        size_t len;
        if (!refresh) {
            if (still) CVPixelBufferRelease(still);
            still = CVPixelBufferRetain(pb);
            stillNs = capNs;
            lastNew = nowNs();
        }
        if (refresh) len = buildFrame(pb, seq + 1, &full, nowNs() - SETTLE_NS, capNs);  // settled tiles, exactly
        else if (motion) len = encodeFrame(pb, seq + 1, key, capNs);
        else len = buildFrame(pb, seq + 1, &full, 0, capNs);
        CVPixelBufferRelease(pb);
        if (!len) continue;

        // Exact pixels unless a frame can't cross the link in time (about one refresh): then
        // moving content goes as H.264 until it calms down.
        if (!refresh && gCanMotion && !gForceMotion) {
            if (!motion) {
                heavy = len > gLinkRate * 0.014 ? heavy + 1 : 0;
                if (heavy >= 3) {
                    gMode = MODE_MOTION;
                    gPrevEncValid = NO;  // a keyframe: the receiver's decoder starts fresh
                    heavy = calm = 0;
                    printf("Big changes faster than the link (%.0f MB/s): H.264 for motion.\n", gLinkRate / 1e6);
                }
            } else {
                size_t area = (size_t)gLastRegionBlocks * BLOCK * BLOCK * 4;
                calm = area / 2 < gLinkRate * 0.014 ? calm + 1 : 0;  // would fit losslessly (LZ4 halves it at least)
                if (calm >= 30) {
                    gMode = MODE_LOSSLESS;
                    calm = 0;
                    printf("Back to exact pixels.\n");
                }
            }
        }

        seq++;
        pthread_mutex_lock(&gLock);
        gInflight++;
        gSendTime[seq & 255] = nowNs();
        gSendLen[seq & 255] = (uint32_t)len;
        if (motion) gStatH264++;
        if (!refresh && capNs && gSendTime[seq & 255] > capNs) {
            gStatToSendNs += gSendTime[seq & 255] - capNs;
            gStatToSendN++;
        }
        pthread_mutex_unlock(&gLock);
        if (!linkSend(gFrm, gMsg, len)) { endSession(); break; }
        pthread_mutex_lock(&gLock);
        gStatFrames++;
        gStatBytes += len;
        pthread_mutex_unlock(&gLock);
    }
    if (still) CVPixelBufferRelease(still);
    return NULL;
}

static void *ackThread(void *arg) {
    pthread_set_qos_class_self_np(QOS_CLASS_USER_INTERACTIVE, 0);
    WinMsg a;
    uint64_t lastAck = 0;
    while (recvAll(gFrm, &a, sizeof a) && a.magic == MAGIC_ACK) {
        uint64_t t = nowNs();
        pthread_mutex_lock(&gLock);
        if (a.a == ACK_WANT_KEYFRAME) {
            gForceKey = YES;
        } else {
            if (gInflight > 0) gInflight--;
            uint64_t sent = gSendTime[a.a & 255], d = t - sent;
            uint32_t len = gSendLen[a.a & 255];
            gStatRtt += d;
            gStatReceiverUs += a.b;
            gStatAcks++;
            // Big frames tell how fast the receiver takes data in: from when this frame could
            // start arriving (sent, or the previous one done) to its ack.
            uint64_t busy = t - MAX(sent, lastAck);
            if (len > (1u << 20) && busy > 0) gLinkRate = gLinkRate * 0.8 + 0.2 * (len * 1e9 / busy);
            lastAck = t;
        }
        pthread_cond_broadcast(&gCond);
        pthread_mutex_unlock(&gLock);
    }
    endSession();
    return NULL;
}

// Heartbeats and clock-sync questions from the receiver.
// ---- The laptop's trackpad and keyboard (HELLO_INPUT) ----
// Posted as real input events, which macOS allows once usbc-display is turned on under
// Privacy & Security > Accessibility. Positions arrive in picture pixels; keys either as Mac
// key codes (shortcuts and keys that aren't characters) or as characters the laptop composed.
static CGEventSourceRef gInSrc;
static CGEventFlags gInFlags;      // modifiers the laptop holds
static int gInButtons;             // bit per mouse button held
static uint64_t gLastClickNs, gTrustCheckNs;
static int gClickCount, gLastClickButton = -1;
static CGPoint gLastClickPos;
static int gTrusted = -1;          // last state told to the receiver
static BOOL gTrustPrompted;

// Tells the receiver when input becomes allowed or not.
static void noteTrust(BOOL ok) {
    if (ok == gTrusted) return;
    gTrusted = ok;
    CtlMsg s = { MAGIC_INPUT_STATE, (uint32_t)ok, 0, 0, {0} };
    dispatch_async(gCtlQueue, ^{ ctlSend(&s, sizeof s); });
}

static BOOL inputAllowed(void) {
    uint64_t t = nowNs();
    if (gTrusted == 1 && t - gTrustCheckNs < 2 * NSEC_PER_SEC) return YES;
    gTrustCheckNs = t;
    BOOL ok = AXIsProcessTrusted();
    if (!ok && !gTrustPrompted) {
        gTrustPrompted = YES;  // opens System Settings at the right place, once per run
        NSDictionary *o = @{ (__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES };
        AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)o);
        printf("The laptop's trackpad and keyboard need usbc-display allowed under Privacy & Security > Accessibility.\n");
    }
    noteTrust(ok);
    return ok;
}

static void post(CGEventRef e) {
    CGEventPost(kCGHIDEventTap, e);
    CFRelease(e);
}

static CGPoint pointerNow(void) {
    CGEventRef e = CGEventCreate(NULL);
    CGPoint p = CGEventGetLocation(e);
    CFRelease(e);
    return p;
}

// Where the laptop's moves last put the pointer: posted events reach the pointer a moment
// later, so relative moves build on this rather than on a position that may still be stale.
static CGPoint gRelPos;
static uint64_t gRelPosNs;

static CGPoint inputPoint(uint32_t packed) {
    if (packed == AT_POINTER) return gRelPosNs && nowNs() - gRelPosNs < 100 * NSEC_PER_MSEC ? gRelPos : pointerNow();
    int x = (int16_t)(packed & 0xFFFF), y = (int16_t)(packed >> 16);
    CGRect b = CGDisplayBounds(gCursorDisplay);
    double s = b.size.width / gCursorOutW;
    return CGPointMake(b.origin.x + (x + 0.5) * s, b.origin.y + (y + 0.5) * s);
}

// Keeps a point on the displays: past every display's edge, it stays at the edge of the one it
// came from (macOS would clamp it the same way).
static CGPoint onSomeDisplay(CGPoint p, CGPoint from) {
    CGDirectDisplayID ids[16];
    uint32_t n = 0;
    CGGetActiveDisplayList(16, ids, &n);
    for (uint32_t i = 0; i < n; i++)
        if (CGRectContainsPoint(CGDisplayBounds(ids[i]), p)) return p;
    for (uint32_t i = 0; i < n; i++) {
        CGRect d = CGDisplayBounds(ids[i]);
        if (!CGRectContainsPoint(d, from)) continue;
        return CGPointMake(MIN(MAX(p.x, CGRectGetMinX(d)), CGRectGetMaxX(d) - 1), MIN(MAX(p.y, CGRectGetMinY(d)), CGRectGetMaxY(d) - 1));
    }
    return from;
}

static void postMove(CGPoint p) {
    CGEventType type = (gInButtons & 1) ? kCGEventLeftMouseDragged : (gInButtons & 2) ? kCGEventRightMouseDragged
                     : gInButtons ? kCGEventOtherMouseDragged : kCGEventMouseMoved;
    CGEventRef e = CGEventCreateMouseEvent(gInSrc, type, p, (gInButtons & 1) ? kCGMouseButtonLeft : (gInButtons & 2) ? kCGMouseButtonRight : kCGMouseButtonCenter);
    CGEventSetFlags(e, gInFlags);
    post(e);
    gRelPos = p;
    gRelPosNs = nowNs();
}

static CGEventFlags macFlags(uint32_t bits) {
    return ((bits & 1) ? kCGEventFlagMaskShift : 0) | ((bits & 2) ? kCGEventFlagMaskControl : 0) |
           ((bits & 4) ? kCGEventFlagMaskAlternate : 0) | ((bits & 8) ? kCGEventFlagMaskCommand : 0);
}


static void handleInput(WinMsg m) {
    if (!inputAllowed()) return;
    if (!gInSrc) {
        gInSrc = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
        CGEventSourceSetLocalEventsSuppressionInterval(gInSrc, 0);  // the Mac's own trackpad keeps working
    }
    switch (m.magic) {
        case MAGIC_IN_MOVE:
            postMove(inputPoint(m.a));
            break;
        case MAGIC_IN_REL: {  // on another display: move by the laptop's motion, at this display's scale
            CGPoint from = inputPoint(AT_POINTER);
            double s = CGDisplayBounds(gCursorDisplay).size.width / gCursorOutW;
            CGPoint to = CGPointMake(from.x + (int32_t)m.a * s, from.y + (int32_t)m.b * s);
            postMove(onSomeDisplay(to, from));
            break;
        }
        case MAGIC_IN_BUTTON: {
            int button = (int)m.a;
            BOOL down = m.b != 0;
            CGPoint p = inputPoint(m.c);
            if (down) {  // double and triple clicks, as macOS counts them
                uint64_t t = nowNs();
                BOOL again = button == gLastClickButton && t - gLastClickNs < (uint64_t)(NSEvent.doubleClickInterval * 1e9) &&
                             fabs(p.x - gLastClickPos.x) < 5 && fabs(p.y - gLastClickPos.y) < 5;
                gClickCount = again ? gClickCount + 1 : 1;
                gLastClickNs = t;
                gLastClickButton = button;
                gLastClickPos = p;
                gInButtons |= 1 << button;
            } else {
                gInButtons &= ~(1 << button);
            }
            CGEventType type = button == 0 ? (down ? kCGEventLeftMouseDown : kCGEventLeftMouseUp)
                             : button == 1 ? (down ? kCGEventRightMouseDown : kCGEventRightMouseUp)
                             : (down ? kCGEventOtherMouseDown : kCGEventOtherMouseUp);
            CGEventRef e = CGEventCreateMouseEvent(gInSrc, type, p, button == 0 ? kCGMouseButtonLeft : button == 1 ? kCGMouseButtonRight : (CGMouseButton)button);
            CGEventSetIntegerValueField(e, kCGMouseEventClickState, gClickCount);
            CGEventSetFlags(e, gInFlags);
            post(e);
            break;
        }
        case MAGIC_IN_SCROLL: {
            // Windows wheel units: 120 per notch (3 lines there; 30 px here is 3 lines on the
            // Mac too). Touchpads send smaller steps as the fingers move: smooth pixel scrolling.
            int dy = (int32_t)m.a, dx = (int32_t)m.b;
            BOOL smooth = dy % 120 || dx % 120;
            double k = smooth ? 0.5 : 0.25;
            CGEventRef e = CGEventCreateScrollWheelEvent2(gInSrc, kCGScrollEventUnitPixel, 2, (int32_t)lround(dy * k), (int32_t)lround(-dx * k), 0);
            CGEventSetIntegerValueField(e, kCGScrollWheelEventIsContinuous, smooth ? 1 : 0);
            CGEventSetLocation(e, inputPoint(m.c));
            CGEventSetFlags(e, gInFlags);
            post(e);
            break;
        }
        case MAGIC_IN_FLAGS: {  // a modifier went down or up
            gInFlags = macFlags(m.c);
            CGEventRef e = CGEventCreateKeyboardEvent(gInSrc, (CGKeyCode)m.a, m.b != 0);
            CGEventSetType(e, kCGEventFlagsChanged);
            CGEventSetFlags(e, gInFlags);
            post(e);
            break;
        }
        case MAGIC_IN_KEY: {
            gInFlags = macFlags(m.c);
            CGEventRef e = CGEventCreateKeyboardEvent(gInSrc, (CGKeyCode)m.a, (m.b & 1) != 0);
            CGEventSetFlags(e, gInFlags);
            if (m.b & 2) CGEventSetIntegerValueField(e, kCGKeyboardEventAutorepeat, 1);
            post(e);
            break;
        }
        case MAGIC_IN_TEXT: {  // a character composed on the laptop, from its own keyboard layout
            UniChar u[2];
            UniCharCount n = 1;
            if (m.a > 0xFFFF) {
                u[0] = (UniChar)(0xD800 + ((m.a - 0x10000) >> 10));
                u[1] = (UniChar)(0xDC00 + ((m.a - 0x10000) & 0x3FF));
                n = 2;
            } else {
                u[0] = (UniChar)m.a;
            }
            for (int down = 1; down >= 0; down--) {
                CGEventRef e = CGEventCreateKeyboardEvent(gInSrc, 0, down);
                CGEventKeyboardSetUnicodeString(e, n, u);
                CGEventSetFlags(e, 0);
                post(e);
            }
            break;
        }
    }
}

// Heartbeats, clock-sync questions and input from the receiver.
static void *controlReader(void *arg) {
    pthread_set_qos_class_self_np(QOS_CLASS_USER_INTERACTIVE, 0);
    WinMsg m;
    while (recvAll(gCtl, &m, sizeof m)) {
        uint64_t t = nowNs();
        pthread_mutex_lock(&gLock);
        gLastHeard = t;
        pthread_mutex_unlock(&gLock);
        if (m.magic == MAGIC_TIME) {
            CtlMsg r = { MAGIC_TIME, m.a, (uint64_t)m.b | (uint64_t)m.c << 32, t, {0} };
            dispatch_async(gCtlQueue, ^{ ctlSend(&r, sizeof r); });
        } else if (m.magic == MAGIC_IN_MOVE || m.magic == MAGIC_IN_BUTTON || m.magic == MAGIC_IN_SCROLL ||
                   m.magic == MAGIC_IN_KEY || m.magic == MAGIC_IN_TEXT || m.magic == MAGIC_IN_FLAGS || m.magic == MAGIC_IN_REL) {
            if (gInputMode) handleInput(m);
        } else if (m.magic != MAGIC_BEAT) {
            break;
        }
    }
    // Nothing stays held: release buttons and modifiers the laptop had down.
    if (gInputMode && gInSrc && gTrusted == 1) {
        CGEventRef e = CGEventCreate(gInSrc);
        CGPoint p = CGEventGetLocation(e);
        CFRelease(e);
        for (int b = 0; b < 3; b++)
            if (gInButtons & (1 << b))
                post(CGEventCreateMouseEvent(gInSrc, b == 0 ? kCGEventLeftMouseUp : b == 1 ? kCGEventRightMouseUp : kCGEventOtherMouseUp, p, (CGMouseButton)b));
        if (gInFlags) {
            CGEventRef f = CGEventCreateKeyboardEvent(gInSrc, 0x37, false);
            CGEventSetType(f, kCGEventFlagsChanged);
            CGEventSetFlags(f, 0);
            post(f);
        }
    }
    gInButtons = 0;
    gInFlags = 0;
    endSession();
    return NULL;
}

// ---- Virtual display ----
static CGVirtualDisplay *createVirtualDisplay(int ptW, int ptH, int pxW, int pxH, int hz, int mmW, int mmH, BOOL hidpi) {
    CGVirtualDisplayDescriptor *d = [[NSClassFromString(@"CGVirtualDisplayDescriptor") alloc] init];
    if (!d) return nil;
    d.queue = dispatch_get_main_queue();
    d.name = @"USB-C Display";
    d.maxPixelsWide = pxW;
    d.maxPixelsHigh = pxH;
    d.sizeInMillimeters = mmW > 0 && mmH > 0 ? CGSizeMake(mmW, mmH) : CGSizeMake(300, 300.0 * pxH / pxW);
    // Fixed IDs so macOS remembers where you put the display in System Settings > Displays.
    d.vendorID = 0x5543;
    d.productID = 0x4344;
    d.serialNum = 1;
    CGVirtualDisplay *vd = [[NSClassFromString(@"CGVirtualDisplay") alloc] initWithDescriptor:d];
    if (!vd) return nil;

    CGVirtualDisplaySettings *s = [[NSClassFromString(@"CGVirtualDisplaySettings") alloc] init];
    s.hiDPI = hidpi ? 1 : 0;
    Class mode = NSClassFromString(@"CGVirtualDisplayMode");
    NSMutableArray *modes = [NSMutableArray arrayWithObject:[[mode alloc] initWithWidth:pxW height:pxH refreshRate:hz]];
    if (hidpi) [modes addObject:[[mode alloc] initWithWidth:ptW height:ptH refreshRate:hz]];
    s.modes = modes;
    return [vd applySettings:s] ? vd : nil;
}

// Pick the mode that looks like ptW x ptH and is backed by pxW x pxH pixels.
static void selectMode(CGDirectDisplayID did, int ptW, int ptH, int pxW, int pxH) {
    NSDictionary *opt = @{(__bridge NSString *)kCGDisplayShowDuplicateLowResolutionModes: @YES};
    for (int tries = 0; tries < 50; tries++) {
        CFArrayRef modes = CGDisplayCopyAllDisplayModes(did, (__bridge CFDictionaryRef)opt);
        CFIndex n = modes ? CFArrayGetCount(modes) : 0;
        if (n == 0) {
            if (modes) CFRelease(modes);
            usleep(100000);
            continue;
        }
        CGDisplayModeRef pick = NULL;
        for (CFIndex i = 0; i < n; i++) {
            CGDisplayModeRef m = (CGDisplayModeRef)CFArrayGetValueAtIndex(modes, i);
            if (CGDisplayModeGetWidth(m) == ptW && CGDisplayModeGetHeight(m) == ptH &&
                CGDisplayModeGetPixelWidth(m) == pxW && CGDisplayModeGetPixelHeight(m) == pxH) pick = m;
        }
        if (pick) CGDisplaySetDisplayMode(did, pick, NULL);
        else {
            printf("Could not find the %dx%d (%dx%d px) mode; available:\n", ptW, ptH, pxW, pxH);
            for (CFIndex i = 0; i < n; i++) {
                CGDisplayModeRef m = (CGDisplayModeRef)CFArrayGetValueAtIndex(modes, i);
                printf("  %zux%zu (%zux%zu px)\n", CGDisplayModeGetWidth(m), CGDisplayModeGetHeight(m),
                       CGDisplayModeGetPixelWidth(m), CGDisplayModeGetPixelHeight(m));
            }
        }
        CFRelease(modes);
        return;
    }
}

static SCDisplay *findCaptureDisplay(CGDirectDisplayID did) {
    for (int tries = 0; tries < 25; tries++) {
        __block SCDisplay *found = nil;
        __block NSError *err = nil;
        dispatch_semaphore_t sem = dispatch_semaphore_create(0);
        [SCShareableContent getShareableContentWithCompletionHandler:^(SCShareableContent *c, NSError *e) {
            for (SCDisplay *d in c.displays) if (d.displayID == did) found = d;
            err = e;
            dispatch_semaphore_signal(sem);
        }];
        dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);
        if (found) return found;
        if (err) {
            fprintf(stderr, "Screen capture failed: %s\n", err.localizedDescription.UTF8String);
            return nil;
        }
        usleep(200000);
    }
    fprintf(stderr, "The virtual display never showed up for capture.\n");
    return nil;
}

// --bench: synthetic frames where every pixel changes, at a fixed rate, to measure the link.
static int gBenchW, gBenchH, gBenchHz;

static void *benchThread(void *arg) {
    CVPixelBufferRef bufs[3];
    for (int i = 0; i < 3; i++)
        CVPixelBufferCreate(NULL, gBenchW, gBenchH, kCVPixelFormatType_32BGRA, NULL, &bufs[i]);
    uint64_t next = nowNs(), period = NSEC_PER_SEC / (gBenchHz > 0 ? gBenchHz : 60);
    for (uint32_t n = 0;; n++) {
        CVPixelBufferRef pb = bufs[n % 3];  // the sender holds at most one other buffer
        CVPixelBufferLockBaseAddress(pb, 0);
        uint8_t *base = CVPixelBufferGetBaseAddress(pb);
        size_t stride = CVPixelBufferGetBytesPerRow(pb);
        for (int y = 0; y < gBenchH; y++)  // noise-like rows, so LZ4 can't shrink them
            for (int x = 0; x < gBenchW; x++) ((uint32_t *)(base + y * stride))[x] = (uint32_t)((x * 2654435761u) ^ (y * 40503u) ^ (n * 97u));
        CVPixelBufferUnlockBaseAddress(pb, 0);
        pthread_mutex_lock(&gLock);
        while (gConnected && gLatest) pthread_cond_wait(&gCond, &gLock);
        if (!gConnected) { pthread_mutex_unlock(&gLock); break; }
        gLatest = CVPixelBufferRetain(pb);
        gLatestNs = nowNs();
        gStatCaptured++;
        pthread_cond_broadcast(&gCond);
        pthread_mutex_unlock(&gLock);
        next += period;  // pace like a real screen refreshing every frame
        uint64_t t = nowNs();
        if (next > t) usleep((useconds_t)((next - t) / 1000));
        else next = t;
    }
    for (int i = 0; i < 3; i++) CVPixelBufferRelease(bufs[i]);
    return NULL;
}

// ---- Test card: sample text on the new display, for judging sharpness (HELLO_TEST_CARD) ----
static NSWindow *gTestCard;

// A borderless window that can take the keyboard (the test card, when typing is tested).
@interface KeyableWindow : NSWindow
@end
@implementation KeyableWindow
- (BOOL)canBecomeKeyWindow { return YES; }
@end

static NSAttributedString *testCardText(void) {
    NSMutableAttributedString *s = [NSMutableAttributedString new];
    void (^add)(NSString *, NSFont *, NSColor *) = ^(NSString *text, NSFont *font, NSColor *color) {
        [s appendAttributedString:[[NSAttributedString alloc] initWithString:text attributes:@{
            NSFontAttributeName: font, NSForegroundColorAttributeName: color }]];
    };
    add(@"USB-C Display test card\n\n", [NSFont systemFontOfSize:24 weight:NSFontWeightSemibold], NSColor.blackColor);
    add(@"The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. "
        @"Sphinx of black quartz, judge my vow. 0123456789 — ¿Qué tal? Ñandú, pingüino, acción.\n\n",
        [NSFont systemFontOfSize:13], NSColor.blackColor);
    add(@"Small print at 11 points: system settings, menu items and file names look like this.\n",
        [NSFont systemFontOfSize:11], NSColor.darkGrayColor);
    add(@"Tiny print at 9 points: footnotes, timestamps and status bars.\n\n",
        [NSFont systemFontOfSize:9], NSColor.grayColor);
    add(@"Red text  ", [NSFont systemFontOfSize:13 weight:NSFontWeightMedium], NSColor.systemRedColor);
    add(@"Blue text  ", [NSFont systemFontOfSize:13 weight:NSFontWeightMedium], NSColor.systemBlueColor);
    add(@"Green text  ", [NSFont systemFontOfSize:13 weight:NSFontWeightMedium], NSColor.systemGreenColor);
    add(@"Orange text\n\n", [NSFont systemFontOfSize:13 weight:NSFontWeightMedium], NSColor.systemOrangeColor);
    add(@"for (int i = 0; i < tiles; i++) {\n    if (dirty[i]) send(tile[i]);  // code at 12 pt\n}\n\n",
        [NSFont monospacedSystemFontOfSize:12 weight:NSFontWeightRegular], NSColor.blackColor);
    // Colour patches (sRGB): greys, skin, sky, sunset and saturated colours, to compare
    // the H.264 path's colours with the lossless path's.
    static const uint8_t patches[][3] = {
        {128, 128, 128}, {200, 200, 200}, {50, 50, 50}, {230, 190, 160}, {150, 170, 200},
        {220, 160, 120}, {220, 40, 40}, {40, 180, 60}, {40, 90, 220}, {150, 60, 200},
    };
    for (size_t i = 0; i < sizeof patches / sizeof *patches; i++) {
        NSColor *c = [NSColor colorWithSRGBRed:patches[i][0] / 255.0 green:patches[i][1] / 255.0 blue:patches[i][2] / 255.0 alpha:1];
        [s appendAttributedString:[[NSAttributedString alloc] initWithString:@"   " attributes:@{
            NSFontAttributeName: [NSFont systemFontOfSize:32], NSBackgroundColorAttributeName: c }]];
    }
    return s;
}

static void showTestCard(CGDirectDisplayID did, int tries, BOOL drag) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 300 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
        NSScreen *screen = nil;
        for (NSScreen *sc in NSScreen.screens)
            if ([sc.deviceDescription[@"NSScreenNumber"] unsignedIntValue] == did) screen = sc;
        if (!screen) {  // the new display can take a moment to show up in NSScreen
            if (tries > 0) showTestCard(did, tries - 1, drag);
            return;
        }
        NSRect f = screen.frame;
        if (drag) {
            // A window-sized card dragged around over the desktop, like moving a Finder
            // window: big changes every frame, part text, part wallpaper.
            NSRect s = f;
            NSWindow *w = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, s.size.width * 0.55, s.size.height * 0.55)
                                                      styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
            w.releasedWhenClosed = NO;
            w.level = NSFloatingWindowLevel;
            w.title = @"USB-C Display drag test";
            NSTextView *text = [[NSTextView alloc] initWithFrame:w.contentView.bounds];
            text.textContainerInset = NSMakeSize(24, 24);
            text.editable = NO;
            [text.textStorage setAttributedString:testCardText()];
            w.contentView = text;
            [w setFrameOrigin:NSMakePoint(s.origin.x + 20, s.origin.y + 20)];
            [w orderFrontRegardless];
            gTestCard = w;
            __block int step = 0;
            dispatch_source_t t = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
            dispatch_source_set_timer(t, dispatch_time(DISPATCH_TIME_NOW, 1500 * NSEC_PER_MSEC), NSEC_PER_SEC / 60, 0);
            dispatch_source_set_event_handler(t, ^{
                if (++step > 480) { dispatch_source_cancel(t); return; }
                double a = step / 60.0, rx = (s.size.width - w.frame.size.width) / 2, ry = (s.size.height - w.frame.size.height) / 2;
                [w setFrameOrigin:NSMakePoint(s.origin.x + rx + rx * cos(a * 1.3), s.origin.y + ry + ry * sin(a * 2.1))];
            });
            dispatch_resume(t);
            return;
        }
        NSWindow *w = [[KeyableWindow alloc] initWithContentRect:f styleMask:NSWindowStyleMaskBorderless
                                                         backing:NSBackingStoreBuffered defer:NO];
        w.releasedWhenClosed = NO;
        w.level = NSFloatingWindowLevel;
        w.backgroundColor = NSColor.whiteColor;
        NSTextView *text = [[NSTextView alloc] initWithFrame:NSMakeRect(0, 0, f.size.width, f.size.height)];
        text.textContainerInset = NSMakeSize(48, 48);
        text.backgroundColor = NSColor.whiteColor;
        text.editable = NO;
        [text.textStorage setAttributedString:testCardText()];
        w.contentView = text;
        [w setFrame:f display:YES];
        [w orderFrontRegardless];
        gTestCard = w;
        if (gInputMode) {
            // With the laptop's keyboard in use, the card takes typing (and logs it), to test it.
            text.editable = YES;
            [NSApp activateIgnoringOtherApps:YES];
            [w makeKeyAndOrderFront:nil];
            [w makeFirstResponder:text];
            [NSNotificationCenter.defaultCenter addObserverForName:NSTextDidChangeNotification object:text queue:nil
                usingBlock:^(NSNotification *n) {
                    NSString *s = text.string;
                    NSString *tail = s.length > 80 ? [s substringFromIndex:s.length - 80] : s;
                    printf("Test card text ends with: %s\n", [tail stringByReplacingOccurrencesOfString:@"\n" withString:@"\\n"].UTF8String);
                }];
            [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown | NSEventMaskScrollWheel | NSEventMaskLeftMouseDown |
                     NSEventMaskLeftMouseUp | NSEventMaskRightMouseDown | NSEventMaskLeftMouseDragged handler:^NSEvent *(NSEvent *e) {
                if (e.type == NSEventTypeLeftMouseDown || e.type == NSEventTypeLeftMouseUp || e.type == NSEventTypeRightMouseDown ||
                    e.type == NSEventTypeLeftMouseDragged) {
                    NSPoint p = NSEvent.mouseLocation;  // global, bottom-left origin
                    NSRect f = w.screen.frame;
                    printf("Test card mouse: %s at %.0f,%.0f clicks %ld\n",
                           e.type == NSEventTypeLeftMouseDown ? "down" : e.type == NSEventTypeLeftMouseUp ? "up" :
                           e.type == NSEventTypeRightMouseDown ? "right down" : "drag",
                           p.x - f.origin.x, f.size.height - (p.y - f.origin.y), (long)(e.type == NSEventTypeLeftMouseDragged ? 0 : e.clickCount));
                } else if (e.type == NSEventTypeScrollWheel)
                    printf("Test card scroll: %.1f, %.1f%s\n", e.scrollingDeltaX, e.scrollingDeltaY, e.hasPreciseScrollingDeltas ? " (smooth)" : "");
                else if (e.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagOption | NSEventModifierFlagControl))
                    printf("Test card key: code %d with%s%s%s\n", e.keyCode, (e.modifierFlags & NSEventModifierFlagCommand) ? " Command" : "",
                           (e.modifierFlags & NSEventModifierFlagOption) ? " Option" : "", (e.modifierFlags & NSEventModifierFlagControl) ? " Control" : "");
                return e;
            }];
        }

        // After a moment, sweep a dark box across the text and remove it, like a pointer
        // passing over: the text it crossed must come back exactly as it was.
        NSView *box = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 90, 36)];
        box.wantsLayer = YES;
        box.layer.backgroundColor = NSColor.darkGrayColor.CGColor;
        __block int step = 0;
        dispatch_source_t t = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
        dispatch_source_set_timer(t, dispatch_time(DISPATCH_TIME_NOW, 1500 * NSEC_PER_MSEC), NSEC_PER_SEC / 60, 0);
        dispatch_source_set_event_handler(t, ^{
            if (step == 0) [text addSubview:box];
            if (++step > 480) {  // 8 s: long enough to measure latency over many frames
                [box removeFromSuperview];
                dispatch_source_cancel(t);
                return;
            }
            int sweep = step % 90;
            [box setFrameOrigin:NSMakePoint(40 + sweep * 12, 90 + (step % 30) * 6)];
        });
        dispatch_resume(t);
    });
}

// With the test card: the display as macOS drew it, at full resolution, for comparing with
// what reaches the laptop (/tmp/usbc-display-native.png; this process may record the screen,
// a shell session may not).
static void saveNativeCapture(SCDisplay *display, int pxW, int pxH) {
    if (@available(macOS 14.0, *)) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 4 * NSEC_PER_SEC), dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
            SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]];
            SCStreamConfiguration *cfg = [SCStreamConfiguration new];
            cfg.width = pxW;
            cfg.height = pxH;
            cfg.showsCursor = NO;
            cfg.colorSpaceName = kCGColorSpaceSRGB;
            [SCScreenshotManager captureImageWithFilter:filter configuration:cfg completionHandler:^(CGImageRef image, NSError *err) {
                if (!image) { printf("Native capture failed: %s\n", err.localizedDescription.UTF8String); return; }
                NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:image];
                [[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:@"/tmp/usbc-display-native.png" atomically:YES];
                printf("Saved the test card as drawn (%zux%zu) to /tmp/usbc-display-native.png.\n", CGImageGetWidth(image), CGImageGetHeight(image));
            }];
        });
    }
}

static void hideTestCard(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        [gTestCard orderOut:nil];
        gTestCard = nil;
    });
}

// The virtual display outlives a connection for a while, so a quick reconnect finds your
// windows where you left them.
enum { DISPLAY_GRACE_SEC = 150 };  // a USB4 link restart takes 35-90 s
static CGVirtualDisplay *gDisplay;
static int gDisplayGeometry[4];   // ptW, ptH, pxW, pxH it was made with
static uint64_t gDisplayExpires;  // 0 while a receiver is connected

static void removeDisplay(void) {
    if (!gDisplay) return;
    // Releasing the object removes the display; macOS moves its windows back.
    dispatch_sync(dispatch_get_main_queue(), ^{ gDisplay = nil; });
    gDisplayExpires = 0;
    printf("Removed the virtual display.\n");
}

// ---- Sessions: one receiver at a time ----
static pthread_mutex_t gSessLock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t gSessCond = PTHREAD_COND_INITIALIZER;
static BOOL gSessionActive;
static pthread_t gSessionThread;
static uint32_t gToken;
static int gPendingJoin = -1;     // a frame connection handed over by the accept loop

typedef struct { int ctl; Hello h; char peer[96]; CFDataRef profile; } SessionArgs;

// Colour-manage the virtual display for the laptop's panel: macOS then renders everything
// shown there for that panel, as it does for its own screen. Without a profile, any earlier
// assignment is removed (the receiver can turn this off).
static BOOL applyPanelProfile(CGDirectDisplayID did, CFDataRef icc) {
    CFUUIDRef uuid = CGDisplayCreateUUIDFromDisplayID(did);
    if (!uuid) return NO;
    id value = [NSNull null];
    if (icc) {
        NSString *dir = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/ColorSync/Profiles"];
        [NSFileManager.defaultManager createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
        NSString *path = [dir stringByAppendingPathComponent:@"USB-C Display laptop panel.icc"];
        if ([(__bridge NSData *)icc writeToFile:path atomically:YES]) value = [NSURL fileURLWithPath:path];
    }
    NSDictionary *info = @{ (__bridge NSString *)kColorSyncDeviceDefaultProfileID: value,
                            (__bridge NSString *)kColorSyncProfileUserScope: (__bridge NSString *)kCFPreferencesCurrentUser };
    bool ok = ColorSyncDeviceSetCustomProfiles(kColorSyncDisplayDeviceClass, uuid, (__bridge CFDictionaryRef)info);
    CFRelease(uuid);
    printf("%s the laptop panel's colour profile %s.\n", ok ? "Applied" : "Could not apply", icc ? "" : "(removed)");
    return ok && icc;
}

static void logStats(double secs) {
    printf("%s  %3.0f fps sent (%llu H.264)  %6.1f MB/s  send->in picture %5.2f ms (receiver %4.2f ms)  link %.0f MB/s  %s\n"
           "    capture delivered after %.2f ms, fitted in %.2f ms (GPU %.2f ms); shown on the Mac -> sending %.2f ms\n",
           [[NSDate date] descriptionWithLocale:nil].UTF8String, gStatFrames / secs, gStatH264, gStatBytes / 1e6 / secs,
           gStatAcks ? gStatRtt / 1e6 / gStatAcks : 0.0, gStatAcks ? gStatReceiverUs / 1e3 / gStatAcks : 0.0,
           gLinkRate / 1e6, gMode == MODE_MOTION ? "motion: H.264" : "exact",
           gStatCaptured ? gStatDeliverNs / 1e6 / gStatCaptured : 0.0, gStatCaptured ? gStatFitNs / 1e6 / gStatCaptured : 0.0,
           gStatCaptured ? gStatGpuNs / 1e6 / gStatCaptured : 0.0, gStatToSendN ? gStatToSendNs / 1e6 / gStatToSendN : 0.0);
    gStatDeliverNs = gStatFitNs = gStatToSendNs = gStatToSendN = gStatGpuNs = 0;
}

// ---- First-run setup: status for the laptop's setup app, and the actions it asks for ----
// windows/setup/CONTRACT.md section 1. Nothing here needs Screen Recording or a session.
#define AGENT_LABEL @"com.usbc-display.sender"
#define AGENT_PLIST @"com.usbc-display.sender.plist"  // in the app: Contents/Library/LaunchAgents
#define APP_IN_APPLICATIONS @"/Applications/USB-C Display.app"
static pthread_mutex_t gStatusLock = PTHREAD_MUTEX_INITIALIZER;
static uint64_t gFreshCheckNs;
static int gFreshScreen = -1;     // what a new process of this program gets: 1 allowed, 0 not, -1 unknown
static BOOL gBusy;                // moving or relaunching: later actions wait for the new process
static void sayGoodbye(uint32_t reason);

static BOOL sendAll(int fd, const void *buf, size_t n) {
    const uint8_t *p = buf;
    while (n) {
        ssize_t k = send(fd, p, n, 0);
        if (k < 0 && errno == EINTR) continue;
        if (k <= 0) return NO;
        p += k; n -= (size_t)k;
    }
    return YES;
}

// Children get stdin, stdout and stderr only. An inherited socket would keep port 48100 (or a
// receiver's connection) open after this process quits.
static pid_t spawn(const char *const argv[], BOOL detached) {
    posix_spawnattr_t a;
    posix_spawnattr_init(&a);
    // Detached: outlives this one (launchd stops a job's whole process group with it).
    posix_spawnattr_setflags(&a, POSIX_SPAWN_CLOEXEC_DEFAULT | (detached ? POSIX_SPAWN_SETSID : 0));
    posix_spawn_file_actions_t fa;
    posix_spawn_file_actions_init(&fa);
    for (int fd = 0; fd <= 2; fd++) posix_spawn_file_actions_addinherit_np(&fa, fd);
    pid_t pid = -1;
    if (posix_spawn(&pid, argv[0], &fa, &a, (char *const *)argv, *_NSGetEnviron()) != 0) pid = -1;
    posix_spawn_file_actions_destroy(&fa);
    posix_spawnattr_destroy(&a);
    return pid;
}

static pid_t spawnDetached(const char *const argv[]) { return spawn(argv, YES); }

static int runTool(const char *const argv[]) {  // waits; the exit code, or -1
    pid_t pid = spawn(argv, NO);
    if (pid < 0) return -1;
    int st;
    while (waitpid(pid, &st, 0) < 0) if (errno != EINTR) return -1;
    return WIFEXITED(st) ? WEXITSTATUS(st) : -1;
}

static void setCloexec(int fd) { fcntl(fd, F_SETFD, FD_CLOEXEC); }

// macOS applies a new Screen Recording grant only to processes started after it, so this
// process can't see a grant made since it started. A new process of this program can: it
// runs "--screen-check" and exits 0 when allowed. Checked only once Screen Recording was asked
// for (the setup is on that step, or a screen wanted it), every 2 s for a minute, then every
// 5 s. One check at a time, never under gStatusLock; others get the last answer.
static pthread_mutex_t gFreshLock = PTHREAD_MUTEX_INITIALIZER;
static uint64_t gScreenAskedNs;
static int screenAllowedForNewProcess(BOOL now) {
    if (!now && !gScreenAskedNs) return -1;
    if (pthread_mutex_trylock(&gFreshLock) != 0) return gFreshScreen;
    uint64_t t = nowNs(), every = gScreenAskedNs && t - gScreenAskedNs < 60 * NSEC_PER_SEC ? 2 : 5;
    if (now || !gFreshCheckNs || t - gFreshCheckNs > every * NSEC_PER_SEC) {
        char path[PATH_MAX];
        uint32_t n = sizeof path;
        const char *argv[] = { path, "--screen-check", NULL };
        pid_t pid;
        int fresh = -1;
        if (_NSGetExecutablePath(path, &n) == 0 && (pid = spawn(argv, NO)) > 0) {
            int st = 0, i = 0;
            pid_t r;
            while ((r = waitpid(pid, &st, WNOHANG)) == 0 && i++ < 300) usleep(10000);
            if (r == 0) { kill(pid, SIGKILL); waitpid(pid, NULL, 0); }
            else if (r == pid && WIFEXITED(st) && WEXITSTATUS(st) <= 1) fresh = WEXITSTATUS(st) == 0;
        }
        gFreshScreen = fresh;
        gFreshCheckNs = nowNs();
    }
    int r = gFreshScreen;
    pthread_mutex_unlock(&gFreshLock);
    return r;
}

static BOOL inApplications(void) {
    return gInBundle && [NSBundle.mainBundle.bundlePath hasPrefix:@"/Applications/"];
}

static NSString *legacyAgentPlist(void) {  // install-agent.sh, and the app's own on macOS 12
#ifdef USBC_TEST_LOOPBACK
    if (getenv("USBC_TEST_HOME"))  // test builds: lets a test flip LOGIN_ITEM_ENABLED
        return [NSString stringWithFormat:@"%s/Library/LaunchAgents/%@.plist", getenv("USBC_TEST_HOME"), AGENT_LABEL];
#endif
    return [NSHomeDirectory() stringByAppendingFormat:@"/Library/LaunchAgents/%@.plist", AGENT_LABEL];
}

static uint32_t loginItemBits(void) {
    if (@available(macOS 13.0, *)) {
        if (gInBundle) {
            SMAppServiceStatus s = [SMAppService agentServiceWithPlistName:AGENT_PLIST].status;
            if (s == SMAppServiceStatusEnabled) return ST_LOGIN_ITEM_ENABLED;
            if (s == SMAppServiceStatusRequiresApproval) return ST_LOGIN_ITEM_NEEDS_APPROVAL;
        }
    }
    return [NSFileManager.defaultManager fileExistsAtPath:legacyAgentPlist()] ? ST_LOGIN_ITEM_ENABLED : 0;
}

static uint32_t currentStatus(void) {
    BOOL screen = gBench || CGPreflightScreenCaptureAccess();
    return (screen ? ST_SCREEN_OK : 0) | (AXIsProcessTrusted() ? ST_AX_OK : 0) |
           (gScreenPrompted ? ST_SCREEN_PROMPTED : 0) | (gTrustPrompted ? ST_AX_PROMPTED : 0) |
           loginItemBits() | (gConnected ? ST_SESSION_ACTIVE : 0) | (gAgent ? ST_RUNNING_AS_AGENT : 0) |
           (inApplications() ? ST_IN_APPLICATIONS : 0) |
           (!screen && screenAllowedForNewProcess(NO) == 1 ? ST_SCREEN_NEEDS_RELAUNCH : 0);
}

static BOOL sendStatus(int fd, uint32_t status, uint32_t refuse) {
    NSOperatingSystemVersion v = NSProcessInfo.processInfo.operatingSystemVersion;
    StatusMsg m = { MAGIC_STATUS, status, (uint64_t)APP_VERSION << 16 | PROTOCOL_VERSION,
                    (uint64_t)v.majorVersion << 32 | (uint64_t)v.minorVersion << 16 | (uint64_t)v.patchVersion, refuse, 0 };
    return sendAll(fd, &m, sizeof m);
}

static void openSettings(NSString *url) {
    [NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:url]];
}

// Asks for Screen Recording (macOS shows its prompt only the first time ever).
static void requestScreenRecording(void) {
    gScreenPrompted = YES;
    gScreenAskedNs = nowNs();
    [NSUserDefaults.standardUserDefaults setBool:YES forKey:@"ScreenPromptShown"];
    dispatch_async(dispatch_get_main_queue(), ^{ CGRequestScreenCaptureAccess(); });
}

// Where the app really is when macOS runs it from a read-only copy (App Translocation, for a
// downloaded app opened where it was saved).
static NSString *originalBundlePath(void) {
    NSString *here = NSBundle.mainBundle.bundlePath;
    void *sec = dlopen("/System/Library/Frameworks/Security.framework/Security", RTLD_LAZY);
    Boolean (*isTranslocated)(CFURLRef, bool *, CFErrorRef *) = sec ? (Boolean (*)(CFURLRef, bool *, CFErrorRef *))dlsym(sec, "SecTranslocateIsTranslocatedURL") : NULL;
    CFURLRef (*original)(CFURLRef, CFErrorRef *) = sec ? (CFURLRef (*)(CFURLRef, CFErrorRef *))dlsym(sec, "SecTranslocateCreateOriginalPathForURL") : NULL;
    bool translocated = false;
    NSURL *url = [NSURL fileURLWithPath:here];
    if (isTranslocated && original && isTranslocated((__bridge CFURLRef)url, &translocated, NULL) && translocated) {
        NSURL *o = CFBridgingRelease(original((__bridge CFURLRef)url, NULL));
        if (o.path) return o.path;
    }
    return here;
}

// Starts the app at path once this process has gone, and quits.
static BOOL openAndQuit(NSString *path) {
    const char *argv[] = { "/bin/sh", "-c", "sleep 1; exec /usr/bin/open -n \"$0\"", path.fileSystemRepresentation, NULL };
    sayGoodbye(2);
    if (spawnDetached(argv) <= 0) return NO;
    exit(0);
}

// Quits so a new Screen Recording grant takes effect, and comes back.
static void relaunch(void) {
    if (gAgent) {
        printf("Restarting so the new permission takes effect.\n");
        sayGoodbye(2);
        exit(0);  // launchd starts the agent again (KeepAlive)
    }
    if (gInBundle) {
        printf("Restarting so the new permission takes effect.\n");
        openAndQuit(originalBundlePath());
        gBusy = NO;
        return;
    }
    printf("Started from a terminal: quit and run it again (the permission belongs to the terminal app).\n");
    gBusy = NO;
}

static NSString *appleScriptString(NSString *s) {
    s = [s stringByReplacingOccurrencesOfString:@"\\" withString:@"\\\\"];
    return [s stringByReplacingOccurrencesOfString:@"\"" withString:@"\\\""];
}

static NSString *shellQuoted(NSString *s) {
    return [NSString stringWithFormat:@"'%@'", [s stringByReplacingOccurrencesOfString:@"'" withString:@"'\\''"]];
}

// Runs a shell command as root once macOS has asked for an administrator's password.
static BOOL runAsAdmin(NSString *cmd) {
    NSString *src = [NSString stringWithFormat:@"do shell script \"%@\" with administrator privileges", appleScriptString(cmd)];
    __block BOOL done = NO;
    void (^run)(void) = ^{
        [NSApp activateIgnoringOtherApps:YES];
        NSDictionary *e = nil;
        done = [[[NSAppleScript alloc] initWithSource:src] executeAndReturnError:&e] != nil;
        if (!done) printf("Not done as administrator: %s\n", [e[NSAppleScriptErrorMessage] description].UTF8String);
    };
    if (NSThread.isMainThread) run();
    else dispatch_sync(dispatch_get_main_queue(), run);
    return done;
}

// The download flag makes macOS run the app from a read-only copy wherever it is.
static BOOL quarantined(NSString *path) {
    return getxattr(path.fileSystemRepresentation, "com.apple.quarantine", NULL, 0, 0, XATTR_NOFOLLOW) >= 0;
}

static NSString *ownTo(NSString *path) {  // shell: give the copy to this account, so updates need no password
    return [NSString stringWithFormat:@"/usr/sbin/chown -R %u:%u %@", getuid(), getgid(), shellQuoted(path)];
}

static BOOL clearQuarantine(NSString *path) {
    const char *xattr[] = { "/usr/bin/xattr", "-dr", "com.apple.quarantine", path.fileSystemRepresentation, NULL };
    if (runTool(xattr) == 0 && !quarantined(path)) return YES;
    printf("Could not clear the download flag on %s; asking for an administrator.\n", path.UTF8String);
    return runAsAdmin([NSString stringWithFormat:@"/usr/bin/xattr -dr com.apple.quarantine %@ && %@", shellQuoted(path), ownTo(path)]) &&
           !quarantined(path);
}

// Copies the app to /Applications (asking for an administrator's password if this account
// can't write there), then starts it from there and quits.
static void moveToApplications(void) {
    if (!gInBundle || inApplications()) {
        printf(gInBundle ? "Already in Applications.\n" : "Only USB-C Display.app can move itself to Applications.\n");
        gBusy = NO;
        return;
    }
    NSFileManager *fm = NSFileManager.defaultManager;
    NSString *here = NSBundle.mainBundle.bundlePath, *from = originalBundlePath(), *dest = APP_IN_APPLICATIONS;
    NSString *there = [NSBundle bundleWithPath:dest].infoDictionary[@"CFBundleVersion"];
    if ([from hasPrefix:@"/Applications/"]) {
        dest = from;  // in Applications already, but run from a read-only copy because of the download flag
        printf("USB-C Display is in Applications but still flagged as downloaded.\n");
    } else if (there.integerValue >= APP_VERSION) {
        printf("USB-C Display is already in Applications; using that copy.\n");
    } else {
        NSError *err = nil;
        BOOL ok = (![fm fileExistsAtPath:dest] || [fm trashItemAtURL:[NSURL fileURLWithPath:dest] resultingItemURL:nil error:&err]) &&
                  [fm copyItemAtPath:here toPath:dest error:&err];
        if (!ok) {
            printf("Could not copy to Applications (%s); asking for an administrator.\n", err.localizedDescription.UTF8String);
            // ditto runs as root here: --noqtn leaves the download flag behind, and the copy is
            // handed to this account.
            ok = runAsAdmin([NSString stringWithFormat:@"/bin/rm -rf %@ && /usr/bin/ditto --noqtn %@ %@ && /usr/bin/xattr -dr com.apple.quarantine %@ && %@",
                             shellQuoted(dest), shellQuoted(here), shellQuoted(dest), shellQuoted(dest), ownTo(dest)]);
        }
        if (!ok) { gBusy = NO; return; }
        if (![from hasPrefix:@"/Applications/"] && [fm fileExistsAtPath:from])
            [fm trashItemAtURL:[NSURL fileURLWithPath:from] resultingItemURL:nil error:nil];
        printf("Copied to %s.\n", dest.UTF8String);
    }
    // Copied by a program, not by Finder: without this macOS would run it from a read-only
    // copy again, and the setup would ask to move it forever.
    if (!clearQuarantine(dest)) {
        printf("%s is still flagged as downloaded; not starting it from there.\n", dest.UTF8String);
        gBusy = NO;
        return;
    }
    openAndQuit(dest);  // an agent registered from the old place is replaced by the new copy
    gBusy = NO;
}

static void runActions(uint32_t actions) {
    NSUserDefaults *d = NSUserDefaults.standardUserDefaults;
    // macOS shows each prompt once ever, and the prompt has its own button to System Settings:
    // the first ask shows the prompt alone, later asks open the page.
    if (actions & ACT_SCREEN) {
        gScreenAskedNs = nowNs();
        if (!CGPreflightScreenCaptureAccess() && ![d boolForKey:@"ScreenPromptShown"]) {
            printf("Setup: asking for Screen Recording.\n");
            requestScreenRecording();
        } else {
            printf("Setup: opening Screen Recording in System Settings.\n");
            gScreenPrompted = YES;
            dispatch_async(dispatch_get_main_queue(), ^{
                openSettings(@"x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
            });
        }
    }
    if (actions & ACT_ACCESSIBILITY) {
        BOOL prompt = !AXIsProcessTrusted() && ![d boolForKey:@"AXPromptShown"];
        printf(prompt ? "Setup: asking for Accessibility.\n" : "Setup: opening Accessibility in System Settings.\n");
        gTrustPrompted = YES;
        [d setBool:YES forKey:@"AXPromptShown"];
        dispatch_async(dispatch_get_main_queue(), ^{
            if (prompt) {
                NSDictionary *o = @{ (__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES };
                AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)o);
            } else {
                openSettings(@"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
            }
        });
    }
    if (actions & ACT_LOGIN_ITEMS) {
        printf("Setup: opening Login Items.\n");
        dispatch_async(dispatch_get_main_queue(), ^{
            if (@available(macOS 13.0, *)) [SMAppService openSystemSettingsLoginItems];
            else [NSWorkspace.sharedWorkspace openURL:[NSURL fileURLWithPath:@"/System/Library/PreferencePanes/Accounts.prefPane"]];
        });
    }
    // Never cut a picture that's showing, and restart only when that can help.
    if ((actions & (ACT_RELAUNCH | ACT_MOVE)) && gConnected) {
        printf("Setup: not restarting or moving while the screen is showing.\n");
        return;
    }
    if ((actions & ACT_RELAUNCH) && !(actions & ACT_MOVE) && (gBench || CGPreflightScreenCaptureAccess())) {
        printf("Setup: no restart needed, Screen Recording works already.\n");
        return;
    }
    if (!(actions & (ACT_RELAUNCH | ACT_MOVE))) return;
    pthread_mutex_lock(&gStatusLock);
    BOOL busy = gBusy;
    gBusy = YES;
    pthread_mutex_unlock(&gStatusLock);
    if (busy) return;
    // After the answer to this QUERY has gone out.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 200 * NSEC_PER_MSEC), dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        if (actions & ACT_MOVE) {
            printf("Setup: moving the app to Applications.\n");
            moveToApplications();
        } else {
            relaunch();
        }
    });
}

typedef struct { int fd; WinMsg q; int slot; uint64_t gen; } ProbeArgs;
// Open setup connections. A full table drops the oldest: an unplugged cable leaves no trace.
static struct { int fd; uint64_t gen; } gProbeSlots[4];
static uint64_t gProbeGen;

// One setup app connection: STATUS now, again whenever a bit changes, and actions on request.
static void *probeMain(void *arg) {
    ProbeArgs *pa = arg;
    int fd = pa->fd, slot = pa->slot;
    WinMsg q = pa->q;
    uint64_t gen = pa->gen;
    free(pa);
    int one = 1, idle = 5, intvl = 2, cnt = 3;
    setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof one);
    setsockopt(fd, SOL_SOCKET, SO_KEEPALIVE, &one, sizeof one);
    setsockopt(fd, IPPROTO_TCP, TCP_KEEPALIVE, &idle, sizeof idle);
    setsockopt(fd, IPPROTO_TCP, TCP_KEEPINTVL, &intvl, sizeof intvl);
    setsockopt(fd, IPPROTO_TCP, TCP_KEEPCNT, &cnt, sizeof cnt);
    struct timeval wait = { 3, 0 };  // a QUERY that starts arriving finishes quickly
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &wait, sizeof wait);
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &wait, sizeof wait);
    printf("Setup app connected (its version %llu).\n", (unsigned long long)(q.b | (uint64_t)q.c << 32));
    uint32_t last = 0;
    uint64_t lastQuery = nowNs();
    for (BOOL query = YES;;) {
        if (query && q.a) runActions(q.a);
        uint32_t st = currentStatus();
        if (query || st != last) {
            if (!sendStatus(fd, st, REFUSE_NONE)) break;
            last = st;
        }
        // The setup app asks every 5 s; silence means it, or the cable, is gone.
        if (nowNs() - lastQuery > 15 * NSEC_PER_SEC) {
            printf("Setup app went quiet.\n");
            break;
        }
        struct pollfd p = { fd, POLLIN, 0 };
        int r = poll(&p, 1, 1000);
        if (r < 0 && errno != EINTR) break;
        query = r > 0;
        if (query && (!recvAll(fd, &q, sizeof q) || q.magic != MAGIC_QUERY)) break;
        if (query) lastQuery = nowNs();
    }
    pthread_mutex_lock(&gStatusLock);
    if (gProbeSlots[slot].gen == gen) gProbeSlots[slot].gen = 0;
    pthread_mutex_unlock(&gStatusLock);
    close(fd);
    printf("Setup app disconnected.\n");
    return NULL;
}

static void startProbe(int fd, WinMsg q) {
    ProbeArgs *pa = malloc(sizeof *pa);
    pa->fd = fd;
    pa->q = q;
    pthread_mutex_lock(&gStatusLock);
    int slot = 0;
    for (int i = 0; i < 4; i++) {
        if (!gProbeSlots[i].gen) { slot = i; break; }
        if (gProbeSlots[i].gen < gProbeSlots[slot].gen) slot = i;
    }
    if (gProbeSlots[slot].gen) {  // its thread closes it
        printf("Too many setup connections; dropping the oldest.\n");
        shutdown(gProbeSlots[slot].fd, SHUT_RDWR);
    }
    gProbeSlots[slot].fd = fd;
    gProbeSlots[slot].gen = pa->gen = ++gProbeGen;
    pa->slot = slot;
    pthread_mutex_unlock(&gStatusLock);
    pthread_t t;
    if (pthread_create(&t, NULL, probeMain, pa) != 0) {
        pthread_mutex_lock(&gStatusLock);
        if (gProbeSlots[slot].gen == pa->gen) gProbeSlots[slot].gen = 0;
        pthread_mutex_unlock(&gStatusLock);
        close(fd);
        free(pa);
        return;
    }
    pthread_detach(t);
}

// The version the login agent was last set up with.
static NSString *agentVersionFile(void) {
    return [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/USB-C Display/agent-version"];
}
static BOOL agentVersionMatches(void) {
    return [NSString stringWithContentsOfFile:agentVersionFile() encoding:NSUTF8StringEncoding error:nil].intValue == APP_VERSION;
}
static void noteAgentVersion(void) {
    NSString *f = agentVersionFile();
    [NSFileManager.defaultManager createDirectoryAtPath:f.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil];
    [[NSString stringWithFormat:@"%d", APP_VERSION] writeToFile:f atomically:YES encoding:NSUTF8StringEncoding error:nil];
}

// Started from Finder, or by macOS after "Quit & Reopen": makes sure the login agent is set up
// to run this copy of the app. YES when the agent takes care of everything and this copy can
// quit; NO when this copy should answer the setup app itself meanwhile.
static BOOL setUpLoginAgent(void) {
    NSString *bundle = NSBundle.mainBundle.bundlePath;
    if (!inApplications()) {
        printf("Running from %s, not from Applications: the laptop's setup will move it.\n", bundle.UTF8String);
        return NO;
    }
    NSFileManager *fm = NSFileManager.defaultManager;
    NSString *legacy = legacyAgentPlist();
    NSArray *legacyArgs = [NSDictionary dictionaryWithContentsOfFile:legacy][@"ProgramArguments"];
    if (legacyArgs && ![legacyArgs.firstObject containsString:@".app/"]) {
        printf("The bare program runs as the login agent already (install-agent.sh); run\n"
               "\"bash mac/install-agent.sh --remove\" first to use the app instead.\n");
        return NO;
    }
    if (@available(macOS 13.0, *)) {
        if (legacyArgs) {  // written by this app on macOS 12, before an upgrade
            const char *bootout[] = { "/bin/launchctl", "bootout", [NSString stringWithFormat:@"gui/%u/%@", getuid(), AGENT_LABEL].UTF8String, NULL };
            runTool(bootout);
            [fm removeItemAtPath:legacy error:nil];
        }
        SMAppService *agent = [SMAppService agentServiceWithPlistName:AGENT_PLIST];
        NSString *dir = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/USB-C Display"];
        NSString *mark = [dir stringByAppendingPathComponent:@"agent-app-path"];
        BOOL same = [[NSString stringWithContentsOfFile:mark encoding:NSUTF8StringEncoding error:nil] isEqualToString:bundle];
        SMAppServiceStatus s = agent.status;
        // An update put a new version here: the running agent is the old one, maybe from the Trash.
        BOOL current = agentVersionMatches();
        if (same && current && s == SMAppServiceStatusEnabled) return YES;
        if (same && !current) printf("Updated to version %d; restarting the login agent.\n", APP_VERSION);
        if (same && s == SMAppServiceStatusRequiresApproval) {
            printf("The login agent is switched off in System Settings > General > Login Items.\n");
            return NO;
        }
        if (s != SMAppServiceStatusNotRegistered && s != SMAppServiceStatusNotFound)
            [agent unregisterAndReturnError:nil];  // registered from another copy of the app
        NSError *err = nil;
        BOOL ok = [agent registerAndReturnError:&err];
        [fm createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
        [bundle writeToFile:mark atomically:YES encoding:NSUTF8StringEncoding error:nil];
        noteAgentVersion();
        s = agent.status;
        printf("Login agent %s%s%s.\n", s == SMAppServiceStatusEnabled ? "registered" :
               s == SMAppServiceStatusRequiresApproval ? "registered, but switched off in Login Items" : "not registered",
               ok ? "" : ": ", ok ? "" : err.localizedDescription.UTF8String);
        return s == SMAppServiceStatusEnabled;
    }
    // macOS 12: a LaunchAgent plist of our own.
    NSString *exe = NSBundle.mainBundle.executablePath;
    if ([legacyArgs.firstObject isEqualToString:exe] && agentVersionMatches()) return YES;
    NSDictionary *plist = @{ @"Label": AGENT_LABEL, @"ProgramArguments": @[ exe, @"--agent" ],
                             @"RunAtLoad": @YES, @"KeepAlive": @YES, @"LimitLoadToSessionType": @"Aqua",
                             @"ProcessType": @"Interactive", @"AssociatedBundleIdentifiers": @[ AGENT_LABEL ] };
    [fm createDirectoryAtPath:legacy.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil];
    NSString *domain = [NSString stringWithFormat:@"gui/%u", getuid()];
    const char *bootout[] = { "/bin/launchctl", "bootout", [domain stringByAppendingFormat:@"/%@", AGENT_LABEL].UTF8String, NULL };
    runTool(bootout);
    if (![plist writeToFile:legacy atomically:YES]) return NO;
    const char *bootstrap[] = { "/bin/launchctl", "bootstrap", domain.UTF8String, legacy.fileSystemRepresentation, NULL };
    BOOL ok = runTool(bootstrap) == 0;
    if (ok) noteAgentVersion();
    printf("Login agent %s.\n", ok ? "installed" : "could not be started");
    return ok;
}

// The bundled app logs to ~/Library/Logs/USB-C Display.log (the agent's plist can't name a
// path in your home folder). Past 20 MB it becomes .log.old; checked at start and hourly.
static void logToLibrary(BOOL start) {
    NSString *log = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Logs/USB-C Display.log"];
    if (start)
        [NSFileManager.defaultManager createDirectoryAtPath:log.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil];
    NSDictionary *a = [NSFileManager.defaultManager attributesOfItemAtPath:log error:nil];
    BOOL big = a.fileSize > (20u << 20);
    if (big) rename(log.fileSystemRepresentation, [log stringByAppendingString:@".old"].fileSystemRepresentation);
    if (!start && !big) return;
    freopen(log.fileSystemRepresentation, "a", stdout);
    freopen(log.fileSystemRepresentation, "a", stderr);
    setvbuf(stdout, NULL, _IOLBF, 0);
    setCloexec(fileno(stdout));
    setCloexec(fileno(stderr));
}

#ifdef USBC_TEST_LOOPBACK
// Test builds only (build.sh never defines it): with USBC_ALLOW_LOOPBACK=1 a local script may
// use the status probe. Nothing else is allowed from loopback.
static BOOL testLoopback(const struct sockaddr_storage *peer) {
    return getenv("USBC_ALLOW_LOOPBACK") && peer->ss_family == AF_INET6 &&
           IN6_IS_ADDR_LOOPBACK(&((const struct sockaddr_in6 *)peer)->sin6_addr);
}
#endif

static void *sessionMain(void *arg) {
    SessionArgs *sa = arg;
    int ctl = sa->ctl;
    Hello h = sa->h;
    int outW = h.width, outH = h.height, hz = h.hz ? h.hz : 60;
    BOOL hidpi;
    int ptW, ptH;
    if (h.ptW && h.ptH && !gNative) {  // the size the receiver asked for, in points
        ptW = h.ptW;
        ptH = h.ptH;
        hidpi = !(ptW == outW && ptH == outH);
    } else {
        int scale = h.scalePercent > 100 ? h.scalePercent : 100;
        hidpi = !gNative && scale > 100;
        ptW = hidpi ? outW * 100 / scale : outW;
        ptH = hidpi ? outH * 100 / scale : outH;
    }
    int pxW = hidpi ? ptW * 2 : ptW, pxH = hidpi ? ptH * 2 : ptH;
    gInputMode = (h.flags & HELLO_INPUT) != 0 && !gBench;  // before the test card, which takes typing then

    if (!gBench && !CGPreflightScreenCaptureAccess()) {
        // Without it the new display would only be a black hole for your windows.
        int fresh = gAgent || gInBundle ? screenAllowedForNewProcess(YES) : 0;
        if (fresh != 1 && !gScreenPrompted) requestScreenRecording();
        printf("Not allowed to record the screen yet: allow %s in System Settings >\n"
               "Privacy & Security > Screen Recording.\n", gAgent || gInBundle ? "USB-C Display" : "your terminal app");
        if (h.flags & HELLO_STATUS) sendStatus(ctl, currentStatus(), REFUSE_NO_SCREEN_RECORDING);
        // A permission granted since this process started only applies to a new one, and
        // launchd starts the agent again right away; the receiver keeps retrying meanwhile.
        if (gAgent && fresh != 0) exit(0);
        close(ctl);
        if (sa->profile) CFRelease(sa->profile);
        free(sa);
        pthread_mutex_lock(&gSessLock);
        gSessionActive = NO;
        pthread_mutex_unlock(&gSessLock);
        return NULL;
    }

    // Welcome the receiver; it then opens the frame connection with this token.
    configureLinkSocket(ctl);
    gConnected = YES;  // linkSend checks it
    gCtl = ctl;
    CtlMsg welcome = { MAGIC_WELCOME, gToken, PROTOCOL_VERSION, 0, {0} };
    int frm = -1;
    if (linkSend(ctl, &welcome, sizeof welcome)) {
        pthread_mutex_lock(&gSessLock);
        struct timespec ts;
        clock_gettime(CLOCK_REALTIME, &ts);
        ts.tv_sec += 3;
        while (gPendingJoin < 0 && pthread_cond_timedwait(&gSessCond, &gSessLock, &ts) == 0) { }
        frm = gPendingJoin;
        gPendingJoin = -1;
        pthread_mutex_unlock(&gSessLock);
    }
    if (frm < 0) {
        printf("The receiver never opened its frame connection.\n");
        gConnected = NO;
        gCtl = -1;
        close(ctl);
        if (sa->profile) CFRelease(sa->profile);
        free(sa);
        pthread_mutex_lock(&gSessLock);
        gSessionActive = NO;
        pthread_mutex_unlock(&gSessLock);
        return NULL;
    }
    configureLinkSocket(frm);
    gFrm = frm;

    CGDirectDisplayID did = CGMainDisplayID();
    BOOL colorManaged = NO;  // rendered for the laptop panel: capture without converting to sRGB
    if (gBench) {
        printf("Benchmark: sending %dx%d frames that change completely, %d per second.\n",
               outW, outH, gMaxBenchHz ? gMaxBenchHz : hz);
    } else if (!gMirror) {
        int geometry[4] = { ptW, ptH, pxW, pxH };
        if (gDisplay && memcmp(geometry, gDisplayGeometry, sizeof geometry) != 0) removeDisplay();
        if (gDisplay) {
            printf("Picking up the \"USB-C Display\" from before.\n");
        } else {
            __block CGVirtualDisplay *vd = nil;
            dispatch_sync(dispatch_get_main_queue(), ^{
                vd = createVirtualDisplay(ptW, ptH, pxW, pxH, hz, h.widthMm, h.heightMm, hidpi);
            });
            if (vd) {
                gDisplay = vd;
                memcpy(gDisplayGeometry, geometry, sizeof geometry);
                selectMode(vd.displayID, ptW, ptH, pxW, pxH);
                printf("Added display \"USB-C Display\": looks like %dx%d, %dx%d pixels, sent at %dx%d.\n"
                       "Arrange it in System Settings > Displays.\n", ptW, ptH, pxW, pxH, outW, outH);
            } else {
                fprintf(stderr, "Could not create the virtual display.\n");
            }
        }
        gDisplayExpires = 0;
        if (gDisplay) {
            did = gDisplay.displayID;
            colorManaged = applyPanelProfile(did, sa->profile);
            if (h.flags & HELLO_TEST_CARD) showTestCard(did, 40, (h.flags & HELLO_TEST_DRAG) != 0);  // a new display can take seconds to appear
        }
    } else {
        printf("Mirroring the main display at %dx%d.\n", outW, outH);
    }

    SCDisplay *display = gBench || (!gMirror && !gDisplay) ? nil : findCaptureDisplay(did);
    SCStream *stream = nil;
    Capture *cap = [Capture new];
    if (display) {
        SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]];
        SCStreamConfiguration *cfg = [SCStreamConfiguration new];
        // Retina modes: capture every pixel macOS draws and shrink it here (Lanczos).
        int capW = outW, capH = outH;
        gScaleW = gScaleH = 0;
        if (!gMirror && !gBilinear && (pxW != outW || pxH != outH) && setupScaler(outW, outH)) {
            capW = pxW;
            capH = pxH;
            printf("Capturing %dx%d and fitting it to %dx%d with a Lanczos filter.\n", pxW, pxH, outW, outH);
        }
        cfg.width = capW;
        cfg.height = capH;
        cfg.pixelFormat = kCVPixelFormatType_32BGRA;
        // Colour-managed: macOS already rendered for the panel, so take its pixels as they are.
        if (!colorManaged) cfg.colorSpaceName = kCGColorSpaceSRGB;
        cfg.minimumFrameInterval = CMTimeMake(1, hz);
        cfg.queueDepth = 4;
        cfg.showsCursor = !(h.flags & HELLO_CURSOR);  // otherwise the receiver draws it
        stream = [[SCStream alloc] initWithFilter:filter configuration:cfg delegate:cap];
        dispatch_queue_attr_t attr = dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL, QOS_CLASS_USER_INTERACTIVE, 0);
        NSError *err = nil;
        [stream addStreamOutput:cap type:SCStreamOutputTypeScreen sampleHandlerQueue:dispatch_queue_create("capture", attr) error:&err];
        __block NSError *startErr = err;
        if (!err) {
            dispatch_semaphore_t sem = dispatch_semaphore_create(0);
            [stream startCaptureWithCompletionHandler:^(NSError *e) { startErr = e; dispatch_semaphore_signal(sem); }];
            dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);
        }
        if (startErr) {
            fprintf(stderr, "Could not start capture: %s\n", startErr.localizedDescription.UTF8String);
            stream = nil;
        }
        if (stream && (h.flags & HELLO_TEST_CARD)) saveNativeCapture(display, gMirror ? outW : pxW, gMirror ? outH : pxH);
    }

    if (stream || gBench) {
        // An idle Mac would dim and sleep its screens, the new one included.
        IOPMAssertionID awake = kIOPMNullAssertionID;
        IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleDisplaySleep, kIOPMAssertionLevelOn,
                                    CFSTR("USB-C Display is showing a screen"), &awake);
        gInflight = 0;
        gLastHeard = nowNs();
        gStatFrames = gStatBytes = gStatRtt = gStatAcks = gStatReceiverUs = gStatCaptured = gStatH264 = 0;
        gNoRefresh = (h.flags & HELLO_VIDEO_ONLY) != 0;
        gForceMotion = (gH264 || (h.flags & (HELLO_H264_HYBRID | HELLO_VIDEO_ONLY))) && (h.flags & HELLO_CAN_H264);
        gCanMotion = (h.flags & HELLO_CAN_H264) && !(h.flags & HELLO_LOSSLESS_ONLY) && !gBench;
        gMode = gForceMotion ? MODE_MOTION : MODE_LOSSLESS;
        gForceKey = YES;
        gPrevEncValid = NO;
        gLinkRate = 700e6;
        if ((gCanMotion || gForceMotion) && !createEncoder(outW, outH, hz)) {
            fprintf(stderr, "Could not start the H.264 encoder; exact pixels only.\n");
            gCanMotion = gForceMotion = NO;
            gMode = MODE_LOSSLESS;
        }
        printf("Sending %s, in pieces of %zu bytes.\n", gForceMotion ? "H.264 for motion" : "exact pixels", gChunk);
        gCursorMode = (h.flags & HELLO_CURSOR) != 0;
        gDumpSentAt = (h.flags & HELLO_TEST_CARD) && !(h.flags & HELLO_TEST_DRAG) ? nowNs() + 12 * NSEC_PER_SEC : 0;
        pthread_t sender, acker, reader, bench = NULL;
        pthread_create(&sender, NULL, senderThread, NULL);
        pthread_create(&acker, NULL, ackThread, NULL);
        pthread_create(&reader, NULL, controlReader, NULL);
        gCursorDisplay = did;
        gCursorOutW = outW;
        gInputMode = (h.flags & HELLO_INPUT) != 0 && !gBench;
        gInButtons = 0;
        gInFlags = 0;
        gTrusted = -1;  // tell this receiver whether input is allowed
        if (gInputMode) dispatch_async(gCtlQueue, ^{ inputAllowed(); });  // asks for permission now, not at the first touch
        if (gCursorMode) startPointer(did, outW);
        __block uint32_t beat = 0;
        gBeatTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, gCtlQueue);
        dispatch_source_set_timer(gBeatTimer, DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC, 10 * NSEC_PER_MSEC);
        dispatch_source_set_event_handler(gBeatTimer, ^{
            CtlMsg b = { MAGIC_BEAT, ++beat, nowNs(), 0, {0} };
            ctlSend(&b, sizeof b);
            if (gInputMode && beat % 10 == 1) sendLayout(beat == 1);  // displays may be rearranged any time
            // A grant in System Settings shows up within a second, without waiting for input.
            if (gInputMode && beat % 10 == 6) noteTrust(AXIsProcessTrusted());
        });
        dispatch_resume(gBeatTimer);
        if (gBench) {
            gBenchW = outW;
            gBenchH = outH;
            gBenchHz = gMaxBenchHz ? gMaxBenchHz : hz;
            pthread_create(&bench, NULL, benchThread, NULL);
        }

        pthread_mutex_lock(&gLock);
        uint64_t lastPrint = nowNs();
        while (gConnected) {
            struct timespec ts;
            clock_gettime(CLOCK_REALTIME, &ts);
            ts.tv_nsec += 200 * NSEC_PER_MSEC;
            if (ts.tv_nsec >= (long)NSEC_PER_SEC) { ts.tv_sec++; ts.tv_nsec -= NSEC_PER_SEC; }
            pthread_cond_timedwait(&gCond, &gLock, &ts);
            uint64_t t = nowNs();
            if (gConnected && t - gLastHeard > 1500 * NSEC_PER_MSEC) {
                // The receiver answers every heartbeat; a stalled link never errors out by itself.
                printf("The receiver stopped responding; dropping the connection.\n");
                pthread_mutex_unlock(&gLock);
                endSession();
                pthread_mutex_lock(&gLock);
                break;
            }
            // Test card: once the sweep is over and the screen still, save the exact picture the
            // receiver now shows (gSent), to compare with a screenshot on the laptop.
            if (gDumpSentAt && t > gDumpSentAt && gSent && !gLatest && gInflight == 0) {
                gDumpSentAt = 0;
                FILE *f = fopen("/tmp/usbc-display-sent.bgra", "wb");
                if (f) {
                    fwrite(&gW, sizeof gW, 1, f);
                    fwrite(&gH, sizeof gH, 1, f);
                    fwrite(gSent, (size_t)gW * 4, (size_t)gH, f);
                    fclose(f);
                    printf("Saved the picture as sent (%dx%d) to /tmp/usbc-display-sent.bgra.\n", gW, gH);
                }
            }
            if (t - lastPrint < 10 * NSEC_PER_SEC) continue;
            if (gStatFrames) logStats((t - lastPrint) / 1e9);
            lastPrint = t;
            gStatFrames = gStatBytes = gStatRtt = gStatAcks = gStatReceiverUs = gStatCaptured = gStatH264 = 0;
        }
        pthread_mutex_unlock(&gLock);
        endSession();
        dispatch_sync(gCtlQueue, ^{ stopTimers(); });
        pthread_join(sender, NULL);
        pthread_join(acker, NULL);
        pthread_join(reader, NULL);
        if (gBench) pthread_join(bench, NULL);
        destroyEncoder();
        if (gTestCard) hideTestCard();

        if (stream) {
            dispatch_semaphore_t sem = dispatch_semaphore_create(0);
            [stream stopCaptureWithCompletionHandler:^(NSError *e) { dispatch_semaphore_signal(sem); }];
            dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC));
        }
        pthread_mutex_lock(&gLock);
        if (gLatest) { CVPixelBufferRelease(gLatest); gLatest = NULL; }
        pthread_mutex_unlock(&gLock);
        IOPMAssertionRelease(awake);
    }
    endSession();
    dispatch_sync(gCtlQueue, ^{
        gCtl = -1;
        gFrm = -1;
    });
    close(ctl);
    close(frm);
    printf("Receiver disconnected.\n");

    if (gDisplay) {
        gDisplayExpires = nowNs() + DISPLAY_GRACE_SEC * NSEC_PER_SEC;
        printf("Keeping the display for %d s in case the receiver comes back.\n", DISPLAY_GRACE_SEC);
    }
    if (sa->profile) CFRelease(sa->profile);
    free(sa);
    pthread_mutex_lock(&gSessLock);
    gSessionActive = NO;
    pthread_mutex_unlock(&gSessLock);
    return NULL;
}

// The Mac is going away: tell the receiver, so it hides at once instead of waiting.
static void sayGoodbye(uint32_t reason) {
    if (!gConnected) return;
    dispatch_sync(gCtlQueue, ^{
        CtlMsg bye = { MAGIC_BYE, reason, 0, 0, {0} };
        ctlSend(&bye, sizeof bye);
    });
    endSession();
}

static void printLinkAddresses(void) {
    struct ifaddrs *list;
    if (getifaddrs(&list) != 0) return;
    BOOL any = NO;
    for (struct ifaddrs *i = list; i; i = i->ifa_next) {
        if (!i->ifa_addr || strncmp(i->ifa_name, "bridge", 6) != 0 || i->ifa_addr->sa_family != AF_INET6) continue;
        char buf[INET6_ADDRSTRLEN] = "";
        inet_ntop(AF_INET6, &((struct sockaddr_in6 *)i->ifa_addr)->sin6_addr, buf, sizeof buf);
        printf("  cable link %s: %s\n", i->ifa_name, buf);
        any = YES;
    }
    if (!any) printf("  No Thunderbolt Bridge network found. Is the USB-C cable plugged in?\n");
    freeifaddrs(list);
}

// Only the cable may start a session: anyone on the Wi-Fi could otherwise add a display and
// watch it. The receiver finds the Mac by its IPv6 link-local address on the Thunderbolt Bridge.
static BOOL peerOnCable(const struct sockaddr_storage *peer, char *ifname) {
    strcpy(ifname, "?");
    if (peer->ss_family != AF_INET6) return NO;
    const struct sockaddr_in6 *p6 = (const struct sockaddr_in6 *)peer;
    if (!IN6_IS_ADDR_LINKLOCAL(&p6->sin6_addr) || !if_indextoname(p6->sin6_scope_id, ifname)) return NO;
    return strncmp(ifname, "bridge", 6) == 0;
}

static void serveForever(void) {
    int ls, one = 1;
    for (BOOL told = NO;; told = YES) {
        ls = socket(AF_INET6, SOCK_STREAM, 0);
        setCloexec(ls);  // children (open, sh, the screen check) must not keep the port
        setsockopt(ls, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
        setsockopt(ls, IPPROTO_IPV6, IPV6_V6ONLY, &one, sizeof one);  // no IPv4: it can't be tied to the cable
        struct sockaddr_in6 addr = { .sin6_len = sizeof addr, .sin6_family = AF_INET6,
                                     .sin6_port = htons(gPort), .sin6_addr = in6addr_any };
        if (bind(ls, (struct sockaddr *)&addr, sizeof addr) == 0 && listen(ls, 4) == 0) break;
        int e = errno;
        close(ls);
        // The agent waits for a copy started from Finder to hand the port over; that copy, or
        // one started while the agent runs, leaves the port to the agent.
        if (gAgent && e == EADDRINUSE) {
            if (!told) printf("Port %d is busy; waiting for it.\n", gPort);
            sleep(2);
            continue;
        }
        if (gInBundle && e == EADDRINUSE) {
            printf("Another copy is answering already; quitting.\n");
            exit(0);
        }
        fprintf(stderr, "Cannot listen on port %d: %s\n", gPort, strerror(e));
        exit(1);
    }
    printf("Waiting for the Windows receiver on port %d...\n", gPort);
    uint64_t lastAgentCheck = nowNs(), lastLogCheck = nowNs();
    for (;;) {
        struct sockaddr_storage peer;
        socklen_t plen = sizeof peer;
        int s = -1;
        while (s < 0) {
            struct pollfd p = { ls, POLLIN, 0 };
            if (poll(&p, 1, 1000) > 0 && (s = accept(ls, (struct sockaddr *)&peer, &plen)) >= 0) setCloexec(s);
            if (s < 0 && gInBundle && nowNs() - lastLogCheck > 3600 * NSEC_PER_SEC) {
                lastLogCheck = nowNs();
                logToLibrary(NO);
            }
            pthread_mutex_lock(&gSessLock);
            BOOL idle = !gSessionActive;
            pthread_mutex_unlock(&gSessLock);
            if (idle && gDisplayExpires && nowNs() > gDisplayExpires) removeDisplay();
            // A copy of the app answering while the login agent couldn't: once the agent is
            // switched on, it takes over.
            if (s < 0 && idle && gInBundle && !gAgent && inApplications() && nowNs() - lastAgentCheck > 2 * NSEC_PER_SEC) {
                lastAgentCheck = nowNs();
                if (loginItemBits() & ST_LOGIN_ITEM_ENABLED) {
                    printf("The login agent is on now; leaving the port to it.\n");
                    exit(0);
                }
            }
        }
        char name[INET6_ADDRSTRLEN] = "?", ifname[IF_NAMESIZE];
        if (peer.ss_family == AF_INET6) inet_ntop(AF_INET6, &((struct sockaddr_in6 *)&peer)->sin6_addr, name, sizeof name);
        BOOL loopbackProbe = NO;
        if (!peerOnCable(&peer, ifname)) {
#ifdef USBC_TEST_LOOPBACK
            loopbackProbe = testLoopback(&peer);
#endif
            if (!loopbackProbe) {
                printf("Refused a connection from %s%%%s: not on the USB-C cable.\n", name, ifname);
                close(s);
                continue;
            }
        }
        // A peer that never says what it wants must not hold the accept loop.
        struct timeval wait = { 3, 0 }, forever = { 0, 0 };
        setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &wait, sizeof wait);
        uint8_t first[sizeof(Hello)];
        if (!recvAll(s, first, sizeof(WinMsg))) { close(s); continue; }
        uint32_t magic = *(uint32_t *)first;
        if (magic == MAGIC_QUERY) {  // the setup app, asking how things stand
            WinMsg q;
            memcpy(&q, first, sizeof q);
            startProbe(s, q);
            continue;
        }
        if (loopbackProbe) { close(s); continue; }
        if (magic == MAGIC_JOIN) {
            WinMsg *j = (WinMsg *)first;
            setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &forever, sizeof forever);
            pthread_mutex_lock(&gSessLock);
            if (gSessionActive && j->a == gToken && gPendingJoin < 0) {
                gPendingJoin = s;
                pthread_cond_broadcast(&gSessCond);
                s = -1;
            }
            pthread_mutex_unlock(&gSessLock);
            if (s >= 0) close(s);
            continue;
        }
        if (magic != MAGIC_HELLO || !recvAll(s, first + sizeof(WinMsg), sizeof(Hello) - sizeof(WinMsg))) {
            close(s);
            continue;
        }
        Hello h;
        memcpy(&h, first, sizeof h);
        if (!(h.flags & HELLO_V2)) {
            printf("A receiver from an older version connected; update the Windows side.\n");
            close(s);
            continue;
        }
        CFDataRef profile = NULL;
        if (h.flags & HELLO_PROFILE) {
            WinMsg ph;
            if (!recvAll(s, &ph, sizeof ph) || ph.magic != MAGIC_PROFILE || ph.a > (4u << 20)) { close(s); continue; }
            NSMutableData *icc = [NSMutableData dataWithLength:ph.a];
            if (!recvAll(s, icc.mutableBytes, ph.a)) { close(s); continue; }
            profile = CFBridgingRetain(icc);
        }
        setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &forever, sizeof forever);
        printf("Receiver connected from %s%%%s: %dx%d at %d%% scale (%dx%d pt asked), %d Hz.\n",
               name, ifname, h.width, h.height, h.scalePercent, h.ptW, h.ptH, h.hz);
        // A new receiver replaces the old one (it may have restarted without us noticing).
        pthread_mutex_lock(&gSessLock);
        BOOL active = gSessionActive;
        pthread_mutex_unlock(&gSessLock);
        if (active) {
            endSession();
            pthread_join(gSessionThread, NULL);
        }
        SessionArgs *sa = calloc(1, sizeof *sa);
        sa->ctl = s;
        sa->h = h;
        sa->profile = profile;
        pthread_mutex_lock(&gSessLock);
        gSessionActive = YES;
        gToken = arc4random() | 1;
        if (gPendingJoin >= 0) { close(gPendingJoin); gPendingJoin = -1; }
        pthread_mutex_unlock(&gSessLock);
        pthread_attr_t attr;
        pthread_attr_init(&attr);
        pthread_attr_set_qos_class_np(&attr, QOS_CLASS_USER_INTERACTIVE, 0);
        pthread_create(&gSessionThread, &attr, sessionMain, sa);
    }
}

static void offerUpdate(void) {
    NSString *from = originalBundlePath();
    NSString *there = [NSBundle bundleWithPath:APP_IN_APPLICATIONS].infoDictionary[@"CFBundleVersion"];
    if ([from hasPrefix:@"/Applications/"]) {  // only the download flag is wrong
        moveToApplications();
        return;
    }
    if (!there || there.integerValue >= APP_VERSION) return;  // a first install: the setup guides the move
    printf("Version %ld is in Applications; this is version %d.\n", (long)there.integerValue, APP_VERSION);
    [NSApp activateIgnoringOtherApps:YES];
    NSAlert *a = [NSAlert new];
    a.messageText = @"Update USB-C Display?";
    a.informativeText = @"This is a newer version than the one in your Applications folder. Update it now?";
    [a addButtonWithTitle:@"Update"];
    [a addButtonWithTitle:@"Not Now"];
    if ([a runModal] == NSAlertFirstButtonReturn) moveToApplications();
}

int main(int argc, const char *argv[]) {
    // Run by screenAllowedForNewProcess: does a new process get to record the screen?
    if (argc == 2 && !strcmp(argv[1], "--screen-check")) return CGPreflightScreenCaptureAccess() ? 0 : 1;
    @autoreleasepool {
        BOOL agentArg = NO;
        for (int i = 1; i < argc; i++) {
            if (!strcmp(argv[i], "--agent")) agentArg = YES;
            else if (!strncmp(argv[i], "-psn_", 5)) { }  // added by older macOS when started from Finder
            else if (!strcmp(argv[i], "--mirror")) gMirror = YES;
            else if (!strcmp(argv[i], "--native")) gNative = YES;
            else if (!strcmp(argv[i], "--no-lz4")) gNoLZ4 = YES;
            else if (!strcmp(argv[i], "--h264")) gH264 = YES;
            else if (!strcmp(argv[i], "--bilinear")) gBilinear = YES;
            else if (!strcmp(argv[i], "--gpu-fit")) gScaleCPU = NO;
            else if (!strcmp(argv[i], "--bench")) {
                gBench = YES;
                if (i + 1 < argc && atoi(argv[i + 1]) > 0) gMaxBenchHz = atoi(argv[++i]);
            }
            else if (!strcmp(argv[i], "--port") && i + 1 < argc) gPort = atoi(argv[++i]);
            else if (!strcmp(argv[i], "--bitrate") && i + 1 < argc) gBitrateMbps = atoi(argv[++i]);
            else if (!strcmp(argv[i], "--max-qp") && i + 1 < argc) gMaxQP = atoi(argv[++i]);
            else {
                printf("usage: usbc-display [--native] [--mirror] [--h264] [--no-lz4] [--bitrate MBPS] [--max-qp N] [--port N] [--bench [FPS]] [--agent]\n"
                       "  --native  1:1 pixels instead of Retina-style scaling (smaller text)\n"
                       "  --mirror  show the Mac's main screen instead of adding a new one\n"
                       "  --h264    send motion as H.264 (as before 2026-10-15) instead of exact pixels\n"
                       "  --no-lz4  send exact pixels uncompressed\n"
                       "  --bilinear  let ScreenCaptureKit fit Retina modes to the laptop (softer) instead of Lanczos\n"
                       "  --bitrate H.264 target in Mbit/s for motion (default 40)\n"
                       "  --max-qp  H.264 quality floor for motion, 0-51, lower is sharper (default 24)\n"
                       "  --bench [FPS]  send frames where every pixel changes (default: the receiver's refresh rate)\n"
                       "  --agent   run as the login agent (the LaunchAgent plists pass it)\n");
                return 0;
            }
        }
        signal(SIGPIPE, SIG_IGN);
        gInBundle = [NSBundle.mainBundle.bundlePath hasSuffix:@".app"];
        // Plists written by older install-agent.sh have no --agent: launchd is the parent there.
        // launchd names the job in XPC_SERVICE_NAME, should --agent ever not arrive.
        const char *job = getenv("XPC_SERVICE_NAME");
        gAgent = agentArg || (job && !strcmp(job, AGENT_LABEL.UTF8String)) || (!gInBundle && getppid() == 1);
        if (gInBundle) logToLibrary(YES);
        setvbuf(stdout, NULL, _IOLBF, 0);  // keep the log file current when piped through tee
        gCtlQueue = dispatch_queue_create("control", dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL, QOS_CLASS_USER_INTERACTIVE, 0));

        // ScreenCaptureKit and virtual displays need a WindowServer connection.
        [NSApplication sharedApplication];
        // Accessory: no Dock icon or menu bar, but allowed to show the test card window.
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        printf("USB-C Display (Mac side) %d, %s\n", APP_VERSION, gAgent ? "running as a login agent" :
               gInBundle ? "started from Finder" : "started from a terminal");
        // A newer download opened outside Applications updates the copy there right away: the
        // old agent holds the port, so the laptop's setup can't reach this copy to ask.
        if (gInBundle && !gAgent && !inApplications()) offerUpdate();
        // The app started from Finder sets up the login agent and leaves the rest to it.
        if (gInBundle && !gAgent && setUpLoginAgent()) {
            printf("The login agent runs USB-C Display from now on; this copy quits.\n");
            return 0;
        }
        // Screen Recording is asked for when the laptop's setup or screen asks, not here: at
        // login there would be no telling what the request is for.
        if (!gBench && !CGPreflightScreenCaptureAccess()) {
            printf("Screen Recording isn't allowed yet. macOS asks for it the first time the laptop\n"
                   "needs it; allow %s in System Settings > Privacy & Security > Screen Recording.\n",
                   gAgent || gInBundle ? "USB-C Display" : "this terminal app");
        }
        // Going to sleep or being stopped: the receiver hides its window right away.
        [NSWorkspace.sharedWorkspace.notificationCenter addObserverForName:NSWorkspaceWillSleepNotification
            object:nil queue:nil usingBlock:^(NSNotification *n) { sayGoodbye(1); }];
        signal(SIGTERM, SIG_IGN);
        dispatch_source_t term = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, SIGTERM, 0, dispatch_get_global_queue(QOS_CLASS_USER_INTERACTIVE, 0));
        dispatch_source_set_event_handler(term, ^{ sayGoodbye(2); exit(0); });
        dispatch_resume(term);

        printLinkAddresses();
        NSThread *server = [[NSThread alloc] initWithBlock:^{ serveForever(); }];
        server.qualityOfService = NSQualityOfServiceUserInteractive;
        [server start];
        [NSApp run];
    }
    return 0;
}
