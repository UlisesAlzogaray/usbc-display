// curpos: where the Mac's pointer is, relative to the USB-C Display. Test tool.
// clang -O2 curpos.c -o /tmp/curpos -framework CoreGraphics -framework CoreFoundation
#include <CoreGraphics/CoreGraphics.h>
#include <stdio.h>

int main(void) {
    CGEventRef e = CGEventCreate(NULL);
    CGPoint p = CGEventGetLocation(e);
    CFRelease(e);
    CGDirectDisplayID ids[16];
    uint32_t n = 0;
    CGGetActiveDisplayList(16, ids, &n);
    for (uint32_t i = 0; i < n; i++)
        if (CGDisplayVendorNumber(ids[i]) == 0x5543) {
            CGRect b = CGDisplayBounds(ids[i]);
            printf("pointer %.1f,%.1f; USB-C Display %.0f,%.0f %.0fx%.0f; on it at %.3f,%.3f of its size\n", p.x, p.y,
                   b.origin.x, b.origin.y, b.size.width, b.size.height, (p.x - b.origin.x) / b.size.width, (p.y - b.origin.y) / b.size.height);
            return 0;
        }
    printf("pointer %.1f,%.1f; no USB-C Display\n", p.x, p.y);
    return 0;
}
