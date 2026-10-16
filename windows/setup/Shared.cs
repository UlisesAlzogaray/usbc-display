namespace UsbcDisplay;

// Link.cs (shared with the receiver) builds Hellos from this. The setup app never sends one,
// so it only needs the shape; the receiver's own version lives in Native.cs.
record struct ScreenInfo(int Width, int Height, int ScalePercent, int Hz, int WidthMm, int HeightMm);
