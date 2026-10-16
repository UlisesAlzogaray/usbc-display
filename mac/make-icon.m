// make-icon: draws the app icon (a laptop in front of a display) as a PNG. build.sh turns it
// into AppIcon.icns.
//   make-icon OUT.png [SIZE]
#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>

static void roundRect(CGContextRef c, CGFloat x, CGFloat y, CGFloat w, CGFloat h, CGFloat r) {
    CGPathRef p = CGPathCreateWithRoundedRect(CGRectMake(x, y, w, h), r, r, NULL);
    CGContextAddPath(c, p);
    CGPathRelease(p);
}

static void fillGradient(CGContextRef c, CGColorSpaceRef cs, const CGFloat top[4], const CGFloat bottom[4], CGFloat y0, CGFloat y1) {
    CGFloat comps[8] = { top[0], top[1], top[2], top[3], bottom[0], bottom[1], bottom[2], bottom[3] };
    CGGradientRef g = CGGradientCreateWithColorComponents(cs, comps, NULL, 2);
    CGContextSaveGState(c);
    CGContextClip(c);
    CGContextDrawLinearGradient(c, g, CGPointMake(0, y0), CGPointMake(0, y1), 0);
    CGContextRestoreGState(c);
    CGGradientRelease(g);
}

int main(int argc, const char *argv[]) {
    if (argc < 2) { fprintf(stderr, "usage: make-icon OUT.png [SIZE]\n"); return 1; }
    int size = argc > 2 ? atoi(argv[2]) : 1024;
    CGColorSpaceRef cs = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef c = CGBitmapContextCreate(NULL, size, size, 8, 0, cs, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
    // Draw in a 1024 grid, y down.
    CGContextTranslateCTM(c, 0, size);
    CGContextScaleCTM(c, size / 1024.0, -size / 1024.0);
    CGContextSetShouldAntialias(c, true);

    // Background: the macOS icon shape, a soft blue gradient with a drop shadow.
    const CGFloat bgTop[4] = { 0.33, 0.64, 1.00, 1 }, bgBottom[4] = { 0.10, 0.37, 0.88, 1 };
    CGContextSaveGState(c);
    CGColorRef shadow = CGColorCreateSRGB(0, 0, 0, 0.28);
    CGContextSetShadowWithColor(c, CGSizeMake(0, -12.0 * size / 1024), 28.0 * size / 1024, shadow);  // device space, y up
    roundRect(c, 100, 100, 824, 824, 186);
    CGContextSetRGBFillColor(c, bgBottom[0], bgBottom[1], bgBottom[2], 1);
    CGContextFillPath(c);
    CGContextRestoreGState(c);
    CGColorRelease(shadow);
    roundRect(c, 100, 100, 824, 824, 186);
    fillGradient(c, cs, bgTop, bgBottom, 100, 924);

    const CGFloat screenTop[4] = { 0.86, 0.93, 1.00, 1 }, screenBottom[4] = { 0.62, 0.78, 1.00, 1 };
    CGContextTranslateCTM(c, 16, 24);  // centre the pair

    // The display, behind.
    CGContextSetRGBFillColor(c, 1, 1, 1, 1);
    roundRect(c, 586, 548, 44, 92, 6);           // neck
    CGContextFillPath(c);
    roundRect(c, 508, 628, 200, 30, 15);         // foot
    CGContextFillPath(c);
    roundRect(c, 392, 252, 432, 314, 36);
    CGContextFillPath(c);
    roundRect(c, 418, 278, 380, 262, 16);
    fillGradient(c, cs, screenTop, screenBottom, 278, 540);

    // The laptop, in front: outlined in the background so the two shapes stay apart.
    CGContextSetLineWidth(c, 36);
    CGContextSetLineJoin(c, kCGLineJoinRound);
    roundRect(c, 214, 448, 356, 234, 28);
    roundRect(c, 168, 680, 448, 46, 20);
    CGContextReplacePathWithStrokedPath(c);
    fillGradient(c, cs, bgTop, bgBottom, 100 - 24, 924 - 24);
    CGContextSetRGBFillColor(c, 1, 1, 1, 1);
    roundRect(c, 214, 448, 356, 234, 28);        // lid
    CGContextFillPath(c);
    roundRect(c, 236, 470, 312, 192, 12);
    fillGradient(c, cs, screenTop, screenBottom, 470, 662);
    CGContextSetRGBFillColor(c, 1, 1, 1, 1);
    roundRect(c, 168, 680, 448, 46, 20);         // base
    CGContextFillPath(c);
    CGContextSetRGBFillColor(c, 0.80, 0.87, 0.98, 1);
    roundRect(c, 346, 680, 92, 14, 7);           // the notch to open the lid
    CGContextFillPath(c);

    CGImageRef img = CGBitmapContextCreateImage(c);
    NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
    CGImageDestinationRef d = CGImageDestinationCreateWithURL((__bridge CFURLRef)url, CFSTR("public.png"), 1, NULL);
    CGImageDestinationAddImage(d, img, NULL);
    bool ok = d && CGImageDestinationFinalize(d);
    if (d) CFRelease(d);
    CGImageRelease(img);
    CGContextRelease(c);
    CGColorSpaceRelease(cs);
    if (!ok) { fprintf(stderr, "Could not write %s\n", argv[1]); return 1; }
    return 0;
}
