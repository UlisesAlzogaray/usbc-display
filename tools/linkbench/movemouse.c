// movemouse: moves the Mac's pointer around the USB-C Display at 125 Hz (like a trackpad),
// to measure how fast pointer moves reach the Windows side. Test tool.
// build: clang -O2 movemouse.c -o /tmp/movemouse -framework CoreGraphics
#include <CoreGraphics/CoreGraphics.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

int main(int argc, char **argv) {
    double seconds = argc > 1 ? atof(argv[1]) : 5;
    CGDirectDisplayID ids[16];
    uint32_t n = 0;
    CGGetActiveDisplayList(16, ids, &n);
    CGRect b = CGRectNull;
    for (uint32_t i = 0; i < n; i++)
        if (CGDisplayVendorNumber(ids[i]) == 0x5543) b = CGDisplayBounds(ids[i]);
    if (CGRectIsNull(b)) { fprintf(stderr, "no USB-C Display\n"); return 1; }
    printf("USB-C Display at %.0f,%.0f %.0fx%.0f\n", b.origin.x, b.origin.y, b.size.width, b.size.height);
    CGEventRef e = CGEventCreate(NULL);
    CGPoint start = CGEventGetLocation(e);
    CFRelease(e);
    int steps = (int)(seconds * 125);
    for (int i = 0; i < steps; i++) {
        double t = i / 125.0;
        CGPoint p = { b.origin.x + b.size.width * (0.5 + 0.4 * cos(t * 2.1)),
                      b.origin.y + b.size.height * (0.5 + 0.4 * sin(t * 3.3)) };
        CGWarpMouseCursorPosition(p);
        usleep(8000);
    }
    CGWarpMouseCursorPosition(start);
    return 0;
}
