// usbc-bench: the Mac end of the USB4 link experiments (a test tool, not part of the product).
//
// Listens on the cable only: IPv6 link-local on bridge*, and IPv4 bound to bridge0's 169.254
// address. Every connection starts with a request from the Windows sink (tools/UsbcSink) that
// says what to send and which socket options to use, so whole experiments are driven from
// Windows. Logs go to /tmp/usbc-bench.log, plus a 10 Hz CSV per connection.
//
// build: clang -O2 -Wall usbc-bench.c -o /tmp/usbc-bench
#define __APPLE_USE_RFC_3542 1
#include <arpa/inet.h>
#include <errno.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <netinet/in.h>
#include <netinet/ip.h>
#include <netinet/ip6.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

#define PORT 48200
#define UDP_PORT 48201
#define MAGIC_REQ   0x52424355u  // "UCBR"
#define MAGIC_FRAME 0x46424355u  // "UCBF"
#define MAGIC_ACK   0x41424355u  // "UCBA"
#define MAGIC_PROBE 0x50424355u  // "UCBP" Windows -> Mac
#define MAGIC_ECHO  0x45424355u  // "UCBE" answer to a probe
#define MAGIC_MACPR 0x51424355u  // "UCBQ" Mac -> Windows
#define WEDGE_NS (3ull * 1000000000ull)

enum { F_IPOPT = 1, F_V6OPT = 2, F_REVERSE = 4, F_NO_NODELAY = 8, F_SMALL = 16 };

typedef struct {
    uint32_t magic, flags;
    uint32_t frameBytes, inflight;
    uint32_t fps, paceMBps;        // 0 = unpaced
    uint64_t totalBytes;
    uint32_t writeBytes, sndbuf;   // 0 = whole frame per send() / system default
    uint32_t runId, connNo;
} Request;                         // 48 bytes
typedef struct { uint32_t magic, seq, len, pad; uint64_t sendNs; } FrameHdr;  // 24 bytes
typedef struct { uint32_t magic, seq; uint64_t pad; } Ack;                   // 16 bytes
typedef struct { uint32_t magic, seq; } Probe;

static const char *gIf = "en2";
static FILE *gLog;
static pthread_mutex_t gLogLock = PTHREAD_MUTEX_INITIALIZER;

static uint64_t nowNs(void) { return clock_gettime_nsec_np(CLOCK_UPTIME_RAW); }

static void lg(const char *fmt, ...) {
    struct timeval tv;
    gettimeofday(&tv, NULL);
    struct tm tm;
    localtime_r(&tv.tv_sec, &tm);
    pthread_mutex_lock(&gLogLock);
    fprintf(gLog, "%02d:%02d:%02d.%03d ", tm.tm_hour, tm.tm_min, tm.tm_sec, (int)(tv.tv_usec / 1000));
    va_list ap;
    va_start(ap, fmt);
    vfprintf(gLog, fmt, ap);
    va_end(ap);
    fputc('\n', gLog);
    fflush(gLog);
    pthread_mutex_unlock(&gLogLock);
}

static int bridgeV4(struct in_addr *out) {
    struct ifaddrs *list, *i;
    int found = 0;
    if (getifaddrs(&list) != 0) return 0;
    for (i = list; i; i = i->ifa_next)
        if (i->ifa_addr && i->ifa_addr->sa_family == AF_INET && !strcmp(i->ifa_name, "bridge0")) {
            *out = ((struct sockaddr_in *)i->ifa_addr)->sin_addr;
            found = 1;
        }
    freeifaddrs(list);
    return found;
}

static int onCable(int s, const struct sockaddr_storage *peer, char *desc, size_t n) {
    char a[INET6_ADDRSTRLEN] = "?", ifn[IF_NAMESIZE] = "?";
    if (peer->ss_family == AF_INET6) {
        const struct sockaddr_in6 *p = (const struct sockaddr_in6 *)peer;
        inet_ntop(AF_INET6, &p->sin6_addr, a, sizeof a);
        int ok = IN6_IS_ADDR_LINKLOCAL(&p->sin6_addr) && if_indextoname(p->sin6_scope_id, ifn) &&
                 !strncmp(ifn, "bridge", 6);
        snprintf(desc, n, "[%s%%%s]", a, ifn);
        return ok;
    }
    if (peer->ss_family == AF_INET) {
        const struct sockaddr_in *p = (const struct sockaddr_in *)peer;
        inet_ntop(AF_INET, &p->sin_addr, a, sizeof a);
        snprintf(desc, n, "%s", a);
        struct sockaddr_in local;
        socklen_t ln = sizeof local;
        struct in_addr b;
        return getsockname(s, (struct sockaddr *)&local, &ln) == 0 && bridgeV4(&b) &&
               local.sin_addr.s_addr == b.s_addr && (ntohl(p->sin_addr.s_addr) >> 16) == 0xA9FE;
    }
    snprintf(desc, n, "?");
    return 0;
}

static int recvAll(int fd, void *buf, size_t n) {
    uint8_t *p = buf;
    while (n) {
        ssize_t k = recv(fd, p, n, 0);
        if (k < 0 && (errno == EINTR || errno == EAGAIN)) return -2;  // timed out: caller decides
        if (k <= 0) return 0;
        p += k; n -= (size_t)k;
    }
    return 1;
}

// ---- en2 queue counters (netstat -qq), the only reliable Mac-side packet count ----
typedef struct { uint64_t pkts, bytes; unsigned qlen; } QStats;
static int readQueue(QStats *q) {
    char cmd[64], line[512];
    snprintf(cmd, sizeof cmd, "/usr/sbin/netstat -qq -I %s 2>/dev/null", gIf);
    FILE *f = popen(cmd, "r");
    if (!f) return 0;
    int got = 0;
    while (fgets(line, sizeof line, f)) {
        char *p;
        if ((p = strstr(line, "qlength:"))) q->qlen = (unsigned)strtoul(p + 8, NULL, 10);
        if (!got && (p = strstr(line, "dequeued pkts:"))) {
            q->pkts = strtoull(p + 14, &p, 10);
            if ((p = strstr(p, "bytes:"))) q->bytes = strtoull(p + 6, NULL, 10);
            got = 1;
        }
    }
    pclose(f);
    return got;
}

// ---- one connection ----
typedef struct {
    int s, family;
    char peer[96];
    Request r;
    volatile int done, wedged;
    volatile uint64_t sent, received, acked, lastProgressNs;
    volatile uint64_t intervalMaxAckNs, maxAckNs, stalls;
    uint64_t sendStart[1024];
    pthread_mutex_t m;
    pthread_cond_t c;
} Conn;

static void *sampler(void *arg) {
    Conn *k = arg;
    char path[128];
    snprintf(path, sizeof path, "/tmp/usbc-bench-run%u-c%u.csv", k->r.runId, k->r.connNo);
    FILE *f = fopen(path, "w");
    if (!f) return NULL;
    fprintf(f, "t_ms,sent,received,acked,max_ack_ms,retx_bytes,srtt_ms,snd_sbbytes,txpackets,%s_deq_pkts,%s_deq_bytes,%s_qlen\n", gIf, gIf, gIf);
    uint64_t t0 = nowNs();
    int after = 0;
    while (after < 100) {   // keep logging 10 s after the end, to see what the queue does
        if (k->done) after++;
        struct tcp_connection_info ti;
        socklen_t tl = sizeof ti;
        memset(&ti, 0, sizeof ti);
        getsockopt(k->s, IPPROTO_TCP, TCP_CONNECTION_INFO, &ti, &tl);
        QStats q = {0};
        readQueue(&q);
        uint64_t mx = k->intervalMaxAckNs;
        k->intervalMaxAckNs = 0;
        fprintf(f, "%llu,%llu,%llu,%llu,%.2f,%llu,%u,%u,%llu,%llu,%llu,%u\n",
                (nowNs() - t0) / 1000000, k->sent, k->received, k->acked, mx / 1e6,
                ti.tcpi_txretransmitbytes, ti.tcpi_srtt, ti.tcpi_snd_sbbytes, ti.tcpi_txpackets,
                q.pkts, q.bytes, q.qlen);
        fflush(f);
        usleep(100000);
    }
    fclose(f);
    return NULL;
}

static void *ackReader(void *arg) {
    Conn *k = arg;
    Ack a;
    while (!k->done) {
        int r = recvAll(k->s, &a, sizeof a);
        if (r == -2) continue;
        if (r <= 0 || a.magic != MAGIC_ACK) break;
        uint64_t t = nowNs(), d = t - k->sendStart[a.seq & 1023];
        pthread_mutex_lock(&k->m);
        k->acked = a.seq;
        k->lastProgressNs = t;
        if (d > k->intervalMaxAckNs) k->intervalMaxAckNs = d;
        if (d > k->maxAckNs) k->maxAckNs = d;
        if (d > 50000000ull) k->stalls++;
        pthread_cond_broadcast(&k->c);
        pthread_mutex_unlock(&k->m);
    }
    pthread_mutex_lock(&k->m);
    k->done = 1;
    pthread_cond_broadcast(&k->c);
    pthread_mutex_unlock(&k->m);
    return NULL;
}

// F_SMALL: never let more than one segment wait in the socket, so tcp_output never has more
// than one MSS to send and can't build a TSO super-packet (TCP_NOTSENT_LOWAT = 1 makes the
// socket writable only once everything written so far has gone out).
static int gMss;
static int sendSmall(Conn *k, const uint8_t *p, size_t n) {
    while (n) {
        size_t c = n < (size_t)gMss ? n : (size_t)gMss;
        ssize_t w = send(k->s, p, c, 0);
        if (w < 0 && (errno == EINTR || errno == EAGAIN)) w = 0;
        else if (w <= 0) return 0;
        p += w; n -= (size_t)w;
        k->sent += (uint64_t)w;
        struct pollfd pf = { k->s, POLLOUT, 0 };
        while (poll(&pf, 1, 100) == 0) {
            if (k->done) return 0;
            if (nowNs() - k->lastProgressNs > WEDGE_NS) { k->wedged = 1; return 0; }
        }
    }
    return 1;
}

// Sends n bytes; returns 0 once the peer is gone or the link has made no progress for 3 s.
static int sendAll(Conn *k, const uint8_t *p, size_t n) {
    if (k->r.flags & F_SMALL) return sendSmall(k, p, n);
    while (n) {
        ssize_t w = send(k->s, p, n, 0);
        if (w < 0 && (errno == EINTR || errno == EAGAIN)) {
            if (k->done) return 0;
            if (nowNs() - k->lastProgressNs > WEDGE_NS) { k->wedged = 1; return 0; }
            continue;
        }
        if (w <= 0) return 0;
        p += w; n -= (size_t)w;
        k->sent += (uint64_t)w;
    }
    return 1;
}

static void runSender(Conn *k) {
    Request *r = &k->r;
    size_t frame = r->frameBytes;
    uint8_t *buf = malloc(sizeof(FrameHdr) + frame);
    for (size_t i = 0; i < frame; i++) buf[sizeof(FrameHdr) + i] = (uint8_t)((i * 2654435761u) >> 13);
    pthread_t ar;
    pthread_create(&ar, NULL, ackReader, k);
    uint64_t t0 = nowNs(), bytesPaced = 0;
    uint32_t inflight = r->inflight ? r->inflight : 2, lastSent = 0;
    for (uint32_t seq = 1; !k->done && k->sent < r->totalBytes; seq++) {
        pthread_mutex_lock(&k->m);
        while (!k->done && seq - 1 - k->acked >= inflight) {
            if (nowNs() - k->lastProgressNs > WEDGE_NS) { k->wedged = 1; break; }
            struct timespec ts;
            struct timeval tv;
            gettimeofday(&tv, NULL);
            ts.tv_sec = tv.tv_sec + 1;
            ts.tv_nsec = tv.tv_usec * 1000;
            pthread_cond_timedwait(&k->c, &k->m, &ts);
        }
        pthread_mutex_unlock(&k->m);
        if (k->done || k->wedged) break;
        if (r->fps) {
            uint64_t due = t0 + (uint64_t)(seq - 1) * 1000000000ull / r->fps;
            while (nowNs() < due) {
                uint64_t left = due - nowNs();
                if (left > 2000000) usleep((useconds_t)((left - 1000000) / 1000));
            }
        }
        FrameHdr *h = (FrameHdr *)buf;
        h->magic = MAGIC_FRAME; h->seq = seq; h->len = (uint32_t)frame; h->pad = 0;
        h->sendNs = nowNs();
        k->sendStart[seq & 1023] = h->sendNs;
        size_t total = sizeof(FrameHdr) + frame, off = 0;
        size_t chunk = r->writeBytes ? r->writeBytes : total;
        while (off < total) {
            size_t n = total - off < chunk ? total - off : chunk;
            if (r->paceMBps) {  // spin so each write starts no earlier than the pace allows
                uint64_t due = t0 + bytesPaced * 1000ull / r->paceMBps;  // bytes / (MB/s) in ns
                while (nowNs() < due) { }
                bytesPaced += n;
            }
            if (!sendAll(k, buf + off, n)) break;
            off += n;
        }
        if (off < total) break;
        lastSent = seq;
    }
    // Wait for the last acks (or the wedge timeout) before closing.
    while (!k->done && !k->wedged && k->acked < lastSent) {
        if (nowNs() - k->lastProgressNs > WEDGE_NS) k->wedged = 1;
        usleep(10000);
    }
    if (k->wedged)
        lg("run %u conn %u: WEDGE: sent %llu bytes, %llu frames acked, no progress for 3 s",
           r->runId, r->connNo, k->sent, k->acked);
    k->done = 1;
    shutdown(k->s, SHUT_RDWR);
    pthread_join(ar, NULL);
    free(buf);
}

static void runReceiver(Conn *k) {
    size_t cap = 16 << 20;
    uint8_t *buf = malloc(cap);
    FrameHdr h;
    for (;;) {
        int r = recvAll(k->s, &h, sizeof h);
        if (r == -2) {
            if (nowNs() - k->lastProgressNs > WEDGE_NS) { k->wedged = 1; break; }
            continue;
        }
        if (r <= 0 || h.magic != MAGIC_FRAME || h.len > cap) break;
        size_t left = h.len;
        while (left) {
            ssize_t n = recv(k->s, buf, left < cap ? left : cap, 0);
            if (n < 0 && (errno == EINTR || errno == EAGAIN)) {
                if (nowNs() - k->lastProgressNs > WEDGE_NS) { k->wedged = 1; break; }
                continue;
            }
            if (n <= 0) break;
            left -= (size_t)n;
            k->received += (uint64_t)n;
            k->lastProgressNs = nowNs();
        }
        if (left) break;
        Ack a = { MAGIC_ACK, h.seq, 0 };
        if (send(k->s, &a, sizeof a, 0) != sizeof a) break;
    }
    if (k->wedged) lg("run %u conn %u: WEDGE (reverse): received %llu bytes, no progress for 3 s", k->r.runId, k->r.connNo, k->received);
    k->done = 1;
    free(buf);
}

static void *connThread(void *arg) {
    Conn *k = arg;
    int one = 1;
    struct timeval tv = { 3, 0 };
    setsockopt(k->s, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
    setsockopt(k->s, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof one);
    if (recvAll(k->s, &k->r, sizeof k->r) != 1 || k->r.magic != MAGIC_REQ) {
        lg("connection from %s: no valid request", k->peer);
        close(k->s);
        free(k);
        return NULL;
    }
    Request *r = &k->r;
    if (!r->frameBytes || r->frameBytes > (64u << 20)) r->frameBytes = 9216000;
    if (!(r->flags & F_NO_NODELAY)) setsockopt(k->s, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
    if (r->sndbuf) {
        int v = (int)r->sndbuf;
        int e = setsockopt(k->s, SOL_SOCKET, SO_SNDBUF, &v, sizeof v);
        lg("run %u: SO_SNDBUF %d -> %s", r->runId, v, e ? strerror(errno) : "ok");
    }
    if (r->flags & F_IPOPT) {
        // XNU only builds TSO super-packets for sockets without IP options (tcp_output).
        uint8_t opt[4] = { IPOPT_NOP, IPOPT_NOP, IPOPT_NOP, IPOPT_EOL };
        int e = k->family == AF_INET ? setsockopt(k->s, IPPROTO_IP, IP_OPTIONS, opt, sizeof opt) : -1;
        lg("run %u: IP_OPTIONS NOP,NOP,NOP,EOL -> %s", r->runId,
           k->family != AF_INET ? "not IPv4" : e ? strerror(errno) : "ok");
    }
    if (r->flags & F_V6OPT) {
        // The IPv6 counterpart: a sticky destination-options header holding only padding.
        uint8_t d[8] = { 0, 0, 1 /* PadN */, 4, 0, 0, 0, 0 };
        int e = k->family == AF_INET6 ? setsockopt(k->s, IPPROTO_IPV6, IPV6_DSTOPTS, d, sizeof d) : -1;
        lg("run %u: IPV6_DSTOPTS padding -> %s", r->runId,
           k->family != AF_INET6 ? "not IPv6" : e ? strerror(errno) : "ok");
    }
    if (r->flags & F_SMALL) {
        int lowat = 1, mss = 0;
        socklen_t ml = sizeof mss;
        int e = setsockopt(k->s, IPPROTO_TCP, TCP_NOTSENT_LOWAT, &lowat, sizeof lowat);
        getsockopt(k->s, IPPROTO_TCP, TCP_MAXSEG, &mss, &ml);
        gMss = mss > 0 ? mss : 1400;
        if (r->writeBytes) gMss = (int)r->writeBytes;  // e.g. 2 segments: still one 4 KB link frame
        lg("run %u: small writes of %d bytes, TCP_NOTSENT_LOWAT 1 -> %s", r->runId, gMss, e ? strerror(errno) : "ok");
    }
    tv.tv_sec = 1;
    setsockopt(k->s, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
    setsockopt(k->s, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof tv);
    int sb = 0;
    socklen_t sl = sizeof sb;
    getsockopt(k->s, SOL_SOCKET, SO_SNDBUF, &sb, &sl);
    lg("run %u conn %u from %s: %s, flags 0x%x, frame %u, inflight %u, fps %u, pace %u MB/s, total %.2f GB, write %u, sndbuf %d",
       r->runId, r->connNo, k->peer, (r->flags & F_REVERSE) ? "reverse (Windows sends)" : "send",
       r->flags, r->frameBytes, r->inflight, r->fps, r->paceMBps, r->totalBytes / 1e9, r->writeBytes, sb);
    pthread_mutex_init(&k->m, NULL);
    pthread_cond_init(&k->c, NULL);
    k->lastProgressNs = nowNs();
    pthread_t sm;
    pthread_create(&sm, NULL, sampler, k);
    uint64_t t0 = nowNs();
    if (r->flags & F_REVERSE) runReceiver(k); else runSender(k);
    double secs = (nowNs() - t0) / 1e9;
    uint64_t bytes = (r->flags & F_REVERSE) ? k->received : k->sent;
    lg("run %u conn %u end: %s, %.3f GB in %.1f s = %.0f MB/s, max send->ack %.1f ms, stalls>50ms %llu",
       r->runId, r->connNo, k->wedged ? "WEDGED" : "closed", bytes / 1e9, secs, bytes / 1e6 / secs,
       k->maxAckNs / 1e6, k->stalls);
    pthread_join(sm, NULL);
    close(k->s);
    free(k);
    return NULL;
}

// ---- UDP probes: tell which direction still works when TCP stops ----
static void *udpThread(void *arg) {
    (void)arg;
    int s6 = socket(AF_INET6, SOCK_DGRAM, 0), one = 1, s4 = -1;
    setsockopt(s6, IPPROTO_IPV6, IPV6_V6ONLY, &one, sizeof one);
    struct sockaddr_in6 a6 = { .sin6_len = sizeof a6, .sin6_family = AF_INET6, .sin6_port = htons(UDP_PORT), .sin6_addr = in6addr_any };
    bind(s6, (struct sockaddr *)&a6, sizeof a6);
    struct in_addr v4cur = { 0 };
    struct sockaddr_storage peer;
    socklen_t peerLen = 0;
    int peerSock = -1;
    uint32_t rx = 0, lastSeq = 0, txSeq = 0, loggedRx = 0;
    uint64_t nextSend = 0, nextLog = 0, nextV4 = 0;
    for (;;) {
        uint64_t t = nowNs();
        if (t >= nextV4) {  // follow bridge0's IPv4 address, which comes and goes with the link
            nextV4 = t + 2000000000ull;
            struct in_addr b;
            int have = bridgeV4(&b);
            if (s4 >= 0 && (!have || b.s_addr != v4cur.s_addr)) {
                if (peerSock == s4) peerSock = -1;
                close(s4); s4 = -1;
            }
            if (s4 < 0 && have) {
                s4 = socket(AF_INET, SOCK_DGRAM, 0);
                unsigned idx = if_nametoindex("bridge0");
                setsockopt(s4, IPPROTO_IP, IP_BOUND_IF, &idx, sizeof idx);
                struct sockaddr_in a4 = { .sin_len = sizeof a4, .sin_family = AF_INET, .sin_port = htons(UDP_PORT), .sin_addr = b };
                if (bind(s4, (struct sockaddr *)&a4, sizeof a4) != 0) { close(s4); s4 = -1; }
                else v4cur = b;
            }
        }
        struct pollfd p[2] = { { s6, POLLIN, 0 }, { s4, POLLIN, 0 } };
        poll(p, s4 >= 0 ? 2 : 1, 50);
        for (int i = 0; i < 2; i++) {
            if (p[i].fd < 0 || !(p[i].revents & POLLIN)) continue;
            Probe pr;
            struct sockaddr_storage from;
            socklen_t fl = sizeof from;
            if (recvfrom(p[i].fd, &pr, sizeof pr, 0, (struct sockaddr *)&from, &fl) != sizeof pr || pr.magic != MAGIC_PROBE) continue;
            char desc[96];
            if (!onCable(p[i].fd, &from, desc, sizeof desc) && from.ss_family == AF_INET6) continue;
            rx++; lastSeq = pr.seq;
            Probe e = { MAGIC_ECHO, pr.seq };
            sendto(p[i].fd, &e, sizeof e, 0, (struct sockaddr *)&from, fl);
            peer = from; peerLen = fl; peerSock = p[i].fd;
        }
        t = nowNs();
        if (peerSock >= 0 && t >= nextSend) {
            nextSend = t + 200000000ull;
            Probe q = { MAGIC_MACPR, ++txSeq };
            sendto(peerSock, &q, sizeof q, 0, (struct sockaddr *)&peer, peerLen);
        }
        if (t >= nextLog) {
            nextLog = t + 5000000000ull;
            if (rx != loggedRx) lg("udp: %u probes from Windows so far (last #%u); sent %u", rx, lastSeq, txSeq);
            loggedRx = rx;
        }
    }
    return NULL;
}

static int listen6(void) {
    int s = socket(AF_INET6, SOCK_STREAM, 0), one = 1;
    setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
    setsockopt(s, IPPROTO_IPV6, IPV6_V6ONLY, &one, sizeof one);
    struct sockaddr_in6 a = { .sin6_len = sizeof a, .sin6_family = AF_INET6, .sin6_port = htons(PORT), .sin6_addr = in6addr_any };
    if (bind(s, (struct sockaddr *)&a, sizeof a) || listen(s, 8)) { perror("listen6"); exit(1); }
    return s;
}

static int listen4(struct in_addr b) {
    int s = socket(AF_INET, SOCK_STREAM, 0), one = 1;
    unsigned idx = if_nametoindex("bridge0");
    setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
    setsockopt(s, IPPROTO_IP, IP_BOUND_IF, &idx, sizeof idx);
    struct sockaddr_in a = { .sin_len = sizeof a, .sin_family = AF_INET, .sin_port = htons(PORT), .sin_addr = b };
    if (bind(s, (struct sockaddr *)&a, sizeof a) || listen(s, 8)) { close(s); return -1; }
    return s;
}

int main(int argc, char **argv) {
    for (int i = 1; i < argc; i++)
        if (!strcmp(argv[i], "--if") && i + 1 < argc) gIf = argv[++i];
    signal(SIGPIPE, SIG_IGN);
    gLog = fopen("/tmp/usbc-bench.log", "a");
    if (!gLog) gLog = stderr;
    lg("usbc-bench started (pid %d), watching %s", getpid(), gIf);
    pthread_t ut;
    pthread_create(&ut, NULL, udpThread, NULL);
    int l6 = listen6(), l4 = -1;
    struct in_addr v4cur = { 0 };
    uint64_t nextV4 = 0;
    for (;;) {
        uint64_t t = nowNs();
        if (t >= nextV4) {
            nextV4 = t + 1000000000ull;
            struct in_addr b;
            int have = bridgeV4(&b);
            if (l4 >= 0 && (!have || b.s_addr != v4cur.s_addr)) { close(l4); l4 = -1; lg("IPv4 listener closed"); }
            if (l4 < 0 && have && (l4 = listen4(b)) >= 0) {
                v4cur = b;
                char a[INET_ADDRSTRLEN];
                lg("IPv4 listener on %s:%d (bridge0)", inet_ntop(AF_INET, &b, a, sizeof a), PORT);
            }
        }
        struct pollfd p[2] = { { l6, POLLIN, 0 }, { l4, POLLIN, 0 } };
        if (poll(p, l4 >= 0 ? 2 : 1, 500) <= 0) continue;
        for (int i = 0; i < 2; i++) {
            if (p[i].fd < 0 || !(p[i].revents & POLLIN)) continue;
            struct sockaddr_storage peer;
            socklen_t pl = sizeof peer;
            int s = accept(p[i].fd, (struct sockaddr *)&peer, &pl);
            if (s < 0) continue;
            Conn *k = calloc(1, sizeof *k);
            k->s = s;
            k->family = peer.ss_family;
            if (!onCable(s, &peer, k->peer, sizeof k->peer)) {
                lg("refused %s: not on the cable", k->peer);
                close(s);
                free(k);
                continue;
            }
            pthread_t th;
            pthread_create(&th, NULL, connThread, k);
            pthread_detach(th);
        }
    }
}
