using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace UsbcSetup;

// The setup window's shadow, shaped and sized like a Mac window's: the page draws a Mac window
// (16 pt corners with macOS's continuous curve) on a transparent canvas, and Windows' own shadow
// would be a square one, so this draws it instead. It is a separate layered window just below
// the setup window, with per-pixel alpha, that clicks pass through.
sealed class MacShadow : NativeWindow, IDisposable
{
    // Mac points: a Gaussian blur of the window's shape, moved down, at this opacity.
    // Inactive: measured on macOS 27 (System Settings in the background). Active: macOS's key
    // window shadow, larger and darker.
    readonly record struct Look(double Sigma, double Down, double Opacity);
    static readonly Look Active = new(15, 14, 0.50), Inactive = new(8, 10, 0.38);

    readonly Form owner;
    double point;         // one Mac point in panel pixels
    bool active = true, shown;
    Size builtFor;
    bool builtActive;
    int margin, down;

    public MacShadow(Form owner)
    {
        this.owner = owner;
        var cp = new CreateParams
        {
            Caption = "",
            Style = unchecked((int)0x80000000),  // WS_POPUP
            ExStyle = 0x00080000 | 0x00000020 | 0x00000080 | 0x08000000,  // LAYERED, TRANSPARENT, TOOLWINDOW, NOACTIVATE
        };
        CreateHandle(cp);
    }

    // From the page: one Mac point in CSS pixels; with the window's DPI, in panel pixels.
    public void SetPoint(double cssPerPoint, int dpi)
    {
        double p = cssPerPoint * dpi / 96.0;
        if (Math.Abs(p - point) < 0.001) return;
        point = p;
        builtFor = Size.Empty;
        Follow();
    }

    public void SetActive(bool on)
    {
        if (on == active) return;
        active = on;
        Follow();
    }

    // Puts the shadow under the window, at its size; hides it while the window is minimized or hidden.
    public void Follow()
    {
        if (Handle == IntPtr.Zero || owner.IsDisposed || !owner.IsHandleCreated) return;
        bool show = point > 0 && owner.Visible && owner.WindowState == FormWindowState.Normal;
        if (!show)
        {
            if (shown) { ShowWindow(Handle, 0); shown = false; }
            return;
        }
        var b = owner.Bounds;
        if (b.Size != builtFor || active != builtActive) Build(b.Size);
        SetWindowPos(Handle, owner.Handle, b.X - margin, b.Y - margin + down, 0, 0, 0x0001u | 0x0010u | (shown ? 0u : 0x0040u));  // NOSIZE, NOACTIVATE, SHOWWINDOW
        shown = true;
    }

    void Build(Size window)
    {
        var look = active ? Active : Inactive;
        double sigma = look.Sigma * point;
        down = (int)Math.Round(look.Down * point);
        margin = (int)Math.Ceiling(sigma * 3) + 2;
        int w = window.Width + 2 * margin, h = window.Height + 2 * margin;

        // The window's shape, as alpha.
        var alpha = new byte[w * h];
        using (var bmp = new Bitmap(w, h, System.Drawing.Imaging.PixelFormat.Format32bppArgb))
        {
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);
                using var path = Squircle(margin, margin, window.Width, window.Height, 16 * point, 0.5);
                using var brush = new SolidBrush(Color.Black);
                g.FillPath(brush, path);
            }
            var data = bmp.LockBits(new Rectangle(0, 0, w, h), System.Drawing.Imaging.ImageLockMode.ReadOnly, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
            var row = new byte[w * 4];
            for (int y = 0; y < h; y++)
            {
                Marshal.Copy(data.Scan0 + y * data.Stride, row, 0, row.Length);
                for (int x = 0; x < w; x++) alpha[y * w + x] = row[x * 4 + 3];
            }
            bmp.UnlockBits(data);
        }

        // Gaussian blur: three box blurs each way.
        var a = new float[w * h];
        for (int i = 0; i < a.Length; i++) a[i] = alpha[i];
        foreach (int r in BoxRadii(sigma)) { BoxH(a, w, h, r); BoxV(a, w, h, r); }

        // Premultiplied black at that alpha.
        var px = new byte[w * h * 4];
        for (int i = 0; i < a.Length; i++) px[i * 4 + 3] = (byte)Math.Clamp(a[i] * look.Opacity + 0.5, 0, 255);
        Upload(px, w, h);
        builtFor = window;
        builtActive = active;
    }

    // macOS's window corner: the same path as the page's (app.js squircle), Figma's corner smoothing.
    public static GraphicsPath Squircle(float x0, float y0, float w, float h, double R, double smooth)
    {
        static double Rad(double d) => d * Math.PI / 180;
        R = Math.Min(R, Math.Min(w, h) / 2);
        double p = Math.Min((1 + smooth) * R, Math.Min(w, h) / 2);
        double arcMeasure = 90 * (1 - smooth);
        double arc = Math.Sin(Rad(arcMeasure / 2)) * R * Math.Sqrt(2);
        double p34 = R * Math.Tan(Rad((90 - arcMeasure) / 4));
        double beta = 45 * smooth;
        double c = p34 * Math.Cos(Rad(beta)), d = c * Math.Tan(Rad(beta));
        double b = (p - arc - c - d) / 3, a = 2 * b;
        var path = new GraphicsPath();
        // One corner, in a frame turned to each corner in turn: x along the edge it starts on (from
        // p before the corner), y along the next edge. It ends at (p, p).
        void Corner(PointF o, PointF ux, PointF uy)
        {
            PointF P(double sx, double sy) => new((float)(o.X + ux.X * sx + uy.X * sy), (float)(o.Y + ux.Y * sx + uy.Y * sy));
            double e = a + b + c;
            path.AddBezier(P(0, 0), P(a, 0), P(a + b, 0), P(e, d));
            // The circular middle: radius R about (p - R, R), from (e, d) to (e + arc, d + arc).
            double cx = p - R, cy = R;
            double t0 = Math.Atan2(d - cy, e - cx), t1 = Math.Atan2(d + arc - cy, e + arc - cx);
            const int steps = 8;
            var pts = new PointF[steps + 1];
            for (int i = 0; i <= steps; i++)
            {
                double t = t0 + (t1 - t0) * i / steps;
                pts[i] = P(cx + R * Math.Cos(t), cy + R * Math.Sin(t));
            }
            path.AddLines(pts);
            path.AddBezier(P(e + arc, d + arc), P(p, d + arc + c), P(p, d + arc + b + c), P(p, p));
        }
        // Corners: top right, bottom right, bottom left, top left (clockwise, y down).
        Corner(new PointF((float)(x0 + w - p), y0), new PointF(1, 0), new PointF(0, 1));
        path.AddLine((float)(x0 + w), (float)(y0 + p), (float)(x0 + w), (float)(y0 + h - p));
        Corner(new PointF(x0 + w, (float)(y0 + h - p)), new PointF(0, 1), new PointF(-1, 0));
        path.AddLine((float)(x0 + w - p), y0 + h, (float)(x0 + p), y0 + h);
        Corner(new PointF((float)(x0 + p), y0 + h), new PointF(-1, 0), new PointF(0, -1));
        path.AddLine(x0, (float)(y0 + h - p), x0, (float)(y0 + p));
        Corner(new PointF(x0, (float)(y0 + p)), new PointF(0, -1), new PointF(1, 0));
        path.CloseFigure();
        return path;
    }

    static int[] BoxRadii(double sigma)
    {
        // Box sizes whose three passes approximate a Gaussian of this sigma.
        double wIdeal = Math.Sqrt(12 * sigma * sigma / 3 + 1);
        int wl = (int)Math.Floor(wIdeal); if (wl % 2 == 0) wl--;
        int wu = wl + 2;
        double mIdeal = (12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4.0 * wl - 4);
        int m = (int)Math.Round(mIdeal);
        var r = new int[3];
        for (int i = 0; i < 3; i++) r[i] = Math.Max(0, ((i < m ? wl : wu) - 1) / 2);
        return r;
    }

    static void BoxH(float[] a, int w, int h, int r)
    {
        if (r <= 0) return;
        var line = new float[w];
        float inv = 1f / (2 * r + 1);
        for (int y = 0; y < h; y++)
        {
            int o = y * w;
            float sum = 0;
            for (int x = -r; x <= r; x++) sum += a[o + Math.Clamp(x, 0, w - 1)];
            for (int x = 0; x < w; x++)
            {
                line[x] = sum * inv;
                sum += a[o + Math.Min(x + r + 1, w - 1)] - a[o + Math.Max(x - r, 0)];
            }
            Array.Copy(line, 0, a, o, w);
        }
    }

    static void BoxV(float[] a, int w, int h, int r)
    {
        if (r <= 0) return;
        var col = new float[h];
        float inv = 1f / (2 * r + 1);
        for (int x = 0; x < w; x++)
        {
            float sum = 0;
            for (int y = -r; y <= r; y++) sum += a[Math.Clamp(y, 0, h - 1) * w + x];
            for (int y = 0; y < h; y++)
            {
                col[y] = sum * inv;
                sum += a[Math.Min(y + r + 1, h - 1) * w + x] - a[Math.Max(y - r, 0) * w + x];
            }
            for (int y = 0; y < h; y++) a[y * w + x] = col[y];
        }
    }

    void Upload(byte[] bgra, int w, int h)
    {
        IntPtr screen = GetDC(IntPtr.Zero), mem = CreateCompatibleDC(screen);
        var bi = new BITMAPINFO { biSize = 40, biWidth = w, biHeight = -h, biPlanes = 1, biBitCount = 32 };
        IntPtr bits, dib = CreateDIBSection(screen, ref bi, 0, out bits, IntPtr.Zero, 0);
        try
        {
            if (dib == IntPtr.Zero) return;
            Marshal.Copy(bgra, 0, bits, bgra.Length);
            IntPtr old = SelectObject(mem, dib);
            var size = new SIZE { cx = w, cy = h };
            var src = new POINT();
            var blend = new BLENDFUNCTION { BlendOp = 0, SourceConstantAlpha = 255, AlphaFormat = 1 };
            UpdateLayeredWindow(Handle, screen, IntPtr.Zero, ref size, mem, ref src, 0, ref blend, 2 /*ULW_ALPHA*/);
            SelectObject(mem, old);
        }
        finally
        {
            if (dib != IntPtr.Zero) DeleteObject(dib);
            DeleteDC(mem);
            ReleaseDC(IntPtr.Zero, screen);
        }
    }

    public void Dispose()
    {
        if (Handle != IntPtr.Zero) DestroyHandle();
    }

    [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx, cy; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential, Pack = 1)] struct BLENDFUNCTION { public byte BlendOp, BlendFlags, SourceConstantAlpha, AlphaFormat; }
    [StructLayout(LayoutKind.Sequential)]
    struct BITMAPINFO
    {
        public int biSize, biWidth, biHeight; public short biPlanes, biBitCount;
        public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant;
        public int bmiColors;
    }
    [DllImport("user32.dll")] static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, IntPtr pptDst, ref SIZE psize, IntPtr hdcSrc, ref POINT pptSrc, int crKey, ref BLENDFUNCTION pblend, int dwFlags);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr hdc);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr hdc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr hdc, ref BITMAPINFO bmi, uint usage, out IntPtr bits, IntPtr section, uint offset);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
}
