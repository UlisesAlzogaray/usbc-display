// scalebench: how fast can 3072x1920 BGRA be shrunk to 1920x1200 with Lanczos (vImage)?
// clang -O2 scalebench.c -o /tmp/scalebench -framework Accelerate
#include <Accelerate/Accelerate.h>
#include <dispatch/dispatch.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static double ms(void) { return clock_gettime_nsec_np(CLOCK_UPTIME_RAW) / 1e6; }

int main(void) {
    int sw = 3072, sh = 1920, dw = 1920, dh = 1200;
    uint8_t *src = malloc((size_t)sw * sh * 4), *dst = malloc((size_t)dw * dh * 4), *dst2 = malloc((size_t)dw * dh * 4);
    for (size_t i = 0; i < (size_t)sw * sh * 4; i++) src[i] = (uint8_t)((i * 2654435761u) >> 13);
    vImage_Buffer s = { src, sh, sw, sw * 4 }, d = { dst, dh, dw, dw * 4 };
    for (int mode = 0; mode < 2; mode++) {
        double best = 1e9;
        for (int r = 0; r < 10; r++) {
            double t = ms();
            vImageScale_ARGB8888(&s, &d, NULL, mode ? kvImageDoNotTile : kvImageNoFlags);
            t = ms() - t;
            if (t < best) best = t;
        }
        printf("vImageScale %s: %.2f ms\n", mode ? "single thread" : "default", best);
    }
    // Strips: 8 source rows map to exactly 5 output rows, so strips with an 8-row source
    // margin each side line up exactly; the margin rows are thrown away.
    int p = 5, q = 8, strips = 16, unit = dh / p, per = (unit + strips - 1) / strips;
    double best = 1e9;
    for (int r = 0; r < 10; r++) {
        double t = ms();
        dispatch_apply(strips, DISPATCH_APPLY_AUTO, ^(size_t k) {
            int u0 = (int)k * per, u1 = u0 + per > unit ? unit : u0 + per;
            if (u0 >= u1) return;
            int m0 = u0 > 0 ? 1 : 0, m1 = u1 < unit ? 1 : 0;   // margin units (8 src rows = 5 dst rows)
            int sy = (u0 - m0) * q, syEnd = (u1 + m1) * q, oy = (u0 - m0) * p, oyEnd = (u1 + m1) * p;
            uint8_t *tmp = malloc((size_t)dw * (oyEnd - oy) * 4);
            vImage_Buffer ss = { src + (size_t)sy * sw * 4, syEnd - sy, sw, sw * 4 }, dd = { tmp, oyEnd - oy, dw, dw * 4 };
            vImageScale_ARGB8888(&ss, &dd, NULL, kvImageDoNotTile);
            memcpy(dst2 + (size_t)u0 * p * dw * 4, tmp + (size_t)m0 * p * dw * 4, (size_t)(u1 - u0) * p * dw * 4);
            free(tmp);
        });
        t = ms() - t;
        if (t < best) best = t;
    }
    // Compare with the whole-image result (away from the image edges, which differ slightly).
    vImageScale_ARGB8888(&s, &d, NULL, kvImageNoFlags);
    size_t diff = 0;
    for (int y = 5; y < dh - 5; y++)
        for (int x = 0; x < dw * 4; x++)
            if (abs(dst[(size_t)y * dw * 4 + x] - dst2[(size_t)y * dw * 4 + x]) > 1) diff++;
    printf("strips x%d: %.2f ms, %zu values differ by more than 1 from the whole-image scale\n", strips, best, diff);
    return 0;
}
