using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace UsbcDisplay;

// This laptop's trackpad and keyboard, used on the Mac's display.
//
// Low-level hooks see the input before Windows acts on it. The pointer: while the picture is
// shown, where the Windows cursor goes (moved by this trackpad) the Mac's pointer goes, and
// clicks and scrolling follow. The keyboard, while the picture's window is in front:
//  - typed characters go as characters, composed by Windows from this keyboard's own layout
//    (accents, AltGr), so you get what the keys say whatever the Mac's layout is;
//  - shortcuts and keys that aren't characters (arrows, Enter, F-keys, Esc...) go as Mac key
//    codes by position, with the modifiers where a Mac has them: Alt (next to the space bar) is
//    Command, the Windows key is Option, Ctrl is Control. AltGr stays AltGr.
// Windows shortcuts (Windows key, Alt+Tab, Alt+F4) then go to the Mac instead; Ctrl+Alt+Esc
// closes the picture.
static unsafe class Input
{
    public const uint Move = 0x6D444355, Button = 0x62444355, Scroll = 0x73444355,  // "UCDm" "UCDb" "UCDs"
                      Key = 0x6B444355, Text = 0x74444355, Flags = 0x66444355,      // "UCDk" "UCDt" "UCDf"
                      Rel = 0x72444355, Layout = 0x4C444355;                         // "UCDr" "UCDL"
    const uint AtPointer = 0xFFFFFFFF;  // a button or scroll wherever the Mac's pointer is

    // ---- Off this screen ----
    // While the Mac's pointer is on another of its displays (pushed across an edge that touches
    // one, or moved there with the Mac's own trackpad), this trackpad moves it relatively, like
    // a second trackpad: the Windows cursor stays hidden in the middle of the screen and each
    // move is sent as the motion it would have made. It comes back when the Mac reports its
    // pointer on this display again.
    public static volatile bool Relative, SawOffDisplay;
    static readonly int[] edgeSpans = new int[8];  // left, right, top, bottom: [start, end) in picture pixels
    static int lastEdge = -1, edgeHits;

    public static void SetLayout(ulong a, ulong b)
    {
        for (int i = 0; i < 4; i++) { edgeSpans[i] = (ushort)(a >> (16 * i)); edgeSpans[4 + i] = (ushort)(b >> (16 * i)); }
    }

    static int ParkX => WinX + Width / 2;
    static int ParkY => WinY + Height / 2;

    // On the UI thread (the hooks' thread), so no move computed against the old cursor position
    // is read against the new one.
    // alreadyOff: the Mac reported its pointer elsewhere (not a crossing from here).
    public static void EnterRelative(bool alreadyOff = false)
    {
        if (Relative) return;
        SawOffDisplay = alreadyOff;
        Relative = true;
        lastEdge = -1;
        Win32.SetCursorPos(ParkX, ParkY);
    }

    public static void ExitRelative(int x, int y)
    {
        if (!Relative) return;
        Relative = false;
        lastEdge = -1;
        Win32.SetCursorPos(WinX + x, WinY + y);
    }

    // Absolute mode: a move past an edge that another display touches crosses it. The hook sees
    // where the cursor would go before Windows stops it at the edge, so a push beyond the screen
    // shows up as a position outside it. In case a device reports it already stopped at the
    // edge, two moves in a row on the edge pixel count too (the first lets you reach it).
    static bool CrossesEdge(int x, int y)
    {
        bool beyond = x < 0 || y < 0 || x >= Width || y >= Height;
        int e = x <= 0 ? 0 : x >= Width - 1 ? 1 : y <= 0 ? 2 : y >= Height - 1 ? 3 : -1;
        int along = e < 2 ? Math.Clamp(y, 0, Height - 1) : Math.Clamp(x, 0, Width - 1);
        if (e < 0 || edgeSpans[e * 2 + 1] <= edgeSpans[e * 2] || along < edgeSpans[e * 2] || along >= edgeSpans[e * 2 + 1])
        {
            lastEdge = -1;
            return false;
        }
        edgeHits = e == lastEdge ? edgeHits + 1 : 1;
        lastEdge = e;
        if (!beyond && edgeHits < 2) return false;
        // Carry on from the edge by the part of the move that went past it.
        int dx = e == 0 ? Math.Min(x, 0) - 1 : e == 1 ? Math.Max(x - (Width - 1), 0) + 1 : 0;
        int dy = e == 2 ? Math.Min(y, 0) - 1 : e == 3 ? Math.Max(y - (Height - 1), 0) + 1 : 0;
        Queue(Move, Pack(Math.Clamp(x, 0, Width - 1), Math.Clamp(y, 0, Height - 1)));
        EnterRelative();
        Queue(Rel, (uint)dx, (uint)dy);
        return true;
    }
    // Modifier bits in Key and Flags messages.
    const uint MShift = 1, MControl = 2, MOption = 4, MCommand = 8;

    public static IntPtr Window;
    public static int WinX, WinY, Width, Height;
    public static volatile bool Enabled;       // a session is running and input is wanted
    public static volatile bool PictureShown;
    public static long LastLocalPointer;       // Stopwatch time of the last move of this trackpad
    public static Action<byte[]> Sender;       // writes one message to the control connection

    static IntPtr keyboardHook, mouseHook;
    static uint mods;
    static bool lCtrl, rCtrl, lAlt, altGr, lWin, rWin, lShift, rShift;
    static readonly bool[] forwardedDown = new bool[256];  // keys whose press went to the Mac
    static char pendingHigh;                                // first half of a surrogate pair
    static readonly ConcurrentQueue<byte[]> queue = new();
    static readonly AutoResetEvent ready = new(false);

    [StructLayout(LayoutKind.Sequential)] struct KbdLL { public uint vkCode, scanCode, flags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MouseLL { public int x, y; public uint mouseData, flags, time; public IntPtr extra; }
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookExW(int id, delegate* unmanaged<int, IntPtr, IntPtr, IntPtr> proc, IntPtr module, uint thread);
    [DllImport("user32.dll")] static extern int UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wp, IntPtr lp);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandleW(char* name);

    // On the UI thread (low-level hooks run on the thread that set them, which needs a message loop).
    public static void Install()
    {
        keyboardHook = SetWindowsHookExW(13 /*WH_KEYBOARD_LL*/, &KeyboardProc, GetModuleHandleW(null), 0);
        mouseHook = SetWindowsHookExW(14 /*WH_MOUSE_LL*/, &MouseProc, GetModuleHandleW(null), 0);
        new Thread(SendLoop) { IsBackground = true, Priority = ThreadPriority.Highest, Name = "input" }.Start();
    }

    public static void Uninstall()
    {
        if (keyboardHook != 0) UnhookWindowsHookEx(keyboardHook);
        if (mouseHook != 0) UnhookWindowsHookEx(mouseHook);
        keyboardHook = mouseHook = 0;
    }

    // Hooks must return at once, so messages are queued and sent from here.
    static void SendLoop()
    {
        while (true)
        {
            ready.WaitOne(200);
            while (queue.TryDequeue(out var m))
                try { Sender?.Invoke(m); } catch { }
        }
    }

    static void Queue(uint magic, uint a, uint b = 0, uint c = 0)
    {
        if (queue.Count > 2000) return;  // the link is stuck; don't pile up
        queue.Enqueue(Proto.WinMsg(magic, a, b, c));
        ready.Set();
    }

    static uint Pack(int x, int y) => (uint)(ushort)x | (uint)(ushort)y << 16;

    // The picture's window lost the keyboard (or the session ended): nothing stays held on the Mac.
    public static void ReleaseAll()
    {
        for (int vk = 0; vk < 256; vk++)
            if (forwardedDown[vk]) { forwardedDown[vk] = false; int mac = lastMacCode[vk]; if (mac >= 0) Queue(Key, (uint)mac, 0, 0); }
        if (mods != 0)
        {
            if ((mods & MCommand) != 0) Queue(Flags, 0x37, 0, 0);
            if ((mods & MOption) != 0) Queue(Flags, 0x3A, 0, 0);
            if ((mods & MControl) != 0) Queue(Flags, 0x3B, 0, 0);
            if ((mods & MShift) != 0) Queue(Flags, 0x38, 0, 0);
        }
        mods = 0;
        lCtrl = rCtrl = lAlt = altGr = lWin = rWin = lShift = rShift = false;
    }
    static readonly int[] lastMacCode = new int[256];

    [UnmanagedCallersOnly]
    static IntPtr KeyboardProc(int code, IntPtr wp, IntPtr lp)
    {
        if (code < 0 || !Enabled || Win32.GetForegroundWindow() != Window) return CallNextHookEx(0, code, wp, lp);
        var k = (KbdLL*)lp;
        bool up = (k->flags & 0x80) != 0, ext = (k->flags & 1) != 0;
        uint vk = k->vkCode & 0xFF;
        // AltGr is reported as a left Ctrl (scan code 0x21D) plus right Alt: that Ctrl isn't one.
        if (vk == 0xA2 && k->scanCode == 0x21D) return CallNextHookEx(0, code, wp, lp);

        switch (vk)
        {
            case 0xA0: case 0xA1:  // Shift: also for Windows, which composes the characters
                if (vk == 0xA0) lShift = !up; else rShift = !up;
                SetMod(MShift, lShift || rShift, vk == 0xA0 ? 0x38 : 0x3C);
                return CallNextHookEx(0, code, wp, lp);
            case 0xA2: case 0xA3:  // Ctrl -> Control
                if (vk == 0xA2) lCtrl = !up; else rCtrl = !up;
                SetMod(MControl, lCtrl || rCtrl, vk == 0xA2 ? 0x3B : 0x3E);
                return CallNextHookEx(0, code, wp, lp);
            case 0xA4:             // left Alt -> Command (and not Windows' Alt)
                lAlt = !up;
                SetMod(MCommand, lAlt, 0x37);
                return (IntPtr)1;
            case 0xA5:             // AltGr: Windows composes @ { } [ ] with it
                altGr = !up;
                return CallNextHookEx(0, code, wp, lp);
            case 0x5B: case 0x5C:  // Windows key -> Option
                if (vk == 0x5B) lWin = !up; else rWin = !up;
                SetMod(MOption, lWin || rWin, vk == 0x5B ? 0x3A : 0x3D);
                return (IntPtr)1;
            case 0x14:             // Caps Lock: Windows keeps the state and composes accordingly
            case 0xE7:             // VK_PACKET: a character with no key (emoji panel, on-screen keyboard)
                return CallNextHookEx(0, code, wp, lp);
        }

        if (vk == 0x1B && !up && (lCtrl || rCtrl) && lAlt)
        {
            Win32.PostMessageW(Window, Win32.WM_CLOSE, 0, 0);  // Ctrl+Alt+Esc: close the picture
            return (IntPtr)1;
        }

        int mac = MacKey(k->scanCode & 0xFF, ext, vk);
        if (up && forwardedDown[vk])
        {
            forwardedDown[vk] = false;
            Queue(Key, (uint)lastMacCode[vk], 0, mods);
            return (IntPtr)1;
        }
        bool shortcut = lAlt || lWin || rWin || ((lCtrl || rCtrl) && !altGr);
        if (mac >= 0 && (shortcut || !IsCharacterKey(vk)))
        {
            if (!up)
            {
                bool repeat = forwardedDown[vk];
                forwardedDown[vk] = true;
                lastMacCode[vk] = mac;
                Queue(Key, (uint)mac, 1u | (repeat ? 2u : 0u), mods);
            }
            return (IntPtr)1;
        }
        return CallNextHookEx(0, code, wp, lp);  // a character: the window's WM_CHAR sends it
    }

    static void SetMod(uint bit, bool down, int macCode)
    {
        uint before = mods;
        mods = down ? mods | bit : mods & ~bit;
        if (mods != before) Queue(Flags, (uint)macCode, down ? 1u : 0u, mods);
    }

    // From the window procedure: a character composed by Windows (UTF-16 unit).
    public static void OnChar(char c)
    {
        if (!Enabled) return;
        if (char.IsHighSurrogate(c)) { pendingHigh = c; return; }
        int cp = char.IsLowSurrogate(c) && pendingHigh != 0 ? char.ConvertToUtf32(pendingHigh, c) : c;
        pendingHigh = '\0';
        if (cp < 0x20 || cp == 0x7F) return;
        Queue(Text, (uint)cp);
    }

    [UnmanagedCallersOnly]
    static IntPtr MouseProc(int code, IntPtr wp, IntPtr lp)
    {
        if (code >= 0 && Enabled && PictureShown)
        {
            var m = (MouseLL*)lp;
            int x = m->x - WinX, y = m->y - WinY;
            if (Relative)
            {
                short d = (short)(m->mouseData >> 16);
                switch ((uint)wp)
                {
                    case 0x200:  // the motion, and the Windows cursor stays where it is
                        int dx = m->x - ParkX, dy = m->y - ParkY;
                        if (dx != 0 || dy != 0) Queue(Rel, (uint)dx, (uint)dy);
                        LastLocalPointer = Stopwatch.GetTimestamp();
                        return (IntPtr)1;
                    case 0x201: Queue(Button, 0, 1, AtPointer); break;
                    case 0x202: Queue(Button, 0, 0, AtPointer); break;
                    case 0x204: Queue(Button, 1, 1, AtPointer); break;
                    case 0x205: Queue(Button, 1, 0, AtPointer); break;
                    case 0x207: Queue(Button, 2, 1, AtPointer); break;
                    case 0x208: Queue(Button, 2, 0, AtPointer); break;
                    case 0x20A: Queue(Scroll, (uint)(int)d, 0, AtPointer); break;
                    case 0x20E: Queue(Scroll, 0, (uint)(int)d, AtPointer); break;
                }
            }
            else if ((uint)wp == 0x200 && (x < 0 || y < 0 || x >= Width || y >= Height) && x > -Width && y > -Height && x < 2 * Width && y < 2 * Height)
            {
                // Pushed past an edge: cross to the display there, if there is one.
                LastLocalPointer = Stopwatch.GetTimestamp();
                if (CrossesEdge(x, y)) return (IntPtr)1;
                Queue(Move, Pack(Math.Clamp(x, 0, Width - 1), Math.Clamp(y, 0, Height - 1)));
            }
            else if (x >= 0 && y >= 0 && x < Width && y < Height)
            {
                uint p = Pack(x, y);
                short delta = (short)(m->mouseData >> 16);
                switch ((uint)wp)
                {
                    case 0x200:
                        LastLocalPointer = Stopwatch.GetTimestamp();
                        if (CrossesEdge(x, y)) return (IntPtr)1;
                        Queue(Move, p);
                        break;
                    case 0x201: Queue(Button, 0, 1, p); break;
                    case 0x202: Queue(Button, 0, 0, p); break;
                    case 0x204: Queue(Button, 1, 1, p); break;
                    case 0x205: Queue(Button, 1, 0, p); break;
                    case 0x207: Queue(Button, 2, 1, p); break;
                    case 0x208: Queue(Button, 2, 0, p); break;
                    case 0x20B: Queue(Button, delta == 1 ? 3u : 4u, 1, p); break;
                    case 0x20C: Queue(Button, delta == 1 ? 3u : 4u, 0, p); break;
                    case 0x20A: Queue(Scroll, (uint)(int)delta, 0, p); break;   // up is positive
                    case 0x20E: Queue(Scroll, 0, (uint)(int)delta, p); break;   // right is positive
                }
            }
        }
        return CallNextHookEx(0, code, wp, lp);
    }

    // Keys that type a character (left to Windows, which composes it): letters, digits and
    // punctuation, without Ctrl/Alt/Windows held.
    static bool IsCharacterKey(uint vk) =>
        (vk >= 0x30 && vk <= 0x5A) || (vk >= 0xBA && vk <= 0xC0) || (vk >= 0xDB && vk <= 0xE2) ||
        (vk >= 0x60 && vk <= 0x6F && vk != 0x6C);  // keypad digits and operators

    // Windows scan code (set 1) -> Mac virtual key code, by position. -1: not sent.
    static int MacKey(uint sc, bool ext, uint vk)
    {
        if (ext)
            return sc switch
            {
                0x1C => 0x4C,  // keypad Enter
                0x35 => 0x4B,  // keypad /
                0x47 => 0x73, 0x48 => 0x7E, 0x49 => 0x74, 0x4B => 0x7B, 0x4D => 0x7C,  // Home Up PgUp Left Right
                0x4F => 0x77, 0x50 => 0x7D, 0x51 => 0x79, 0x52 => 0x72, 0x53 => 0x75,  // End Down PgDn Insert(Help) Delete
                0x20 => 0x4A, 0x2E => 0x49, 0x30 => 0x48,                               // mute, volume down, up
                _ => -1,
            };
        return sc < (uint)ScanToMac.Length ? ScanToMac[sc] : sc == 0x57 ? 0x67 : sc == 0x58 ? 0x6F : -1;  // F11 F12
    }

    static readonly int[] ScanToMac =
    {
        -1,   0x35, 0x12, 0x13, 0x14, 0x15, 0x17, 0x16, 0x1A, 0x1C, 0x19, 0x1D, 0x1B, 0x18, 0x33, 0x30,  // 00 Esc 1-0 - = Bksp Tab
        0x0C, 0x0D, 0x0E, 0x0F, 0x11, 0x10, 0x20, 0x22, 0x1F, 0x23, 0x21, 0x1E, 0x24, 0x3B, 0x00, 0x01,  // 10 Q-P [ ] Enter LCtrl A S
        0x02, 0x03, 0x05, 0x04, 0x26, 0x28, 0x25, 0x29, 0x27, 0x32, 0x38, 0x2A, 0x06, 0x07, 0x08, 0x09,  // 20 D-L ; ' ` LShift \ Z X C V
        0x0B, 0x2D, 0x2E, 0x2B, 0x2F, 0x2C, 0x3C, 0x43, 0x37, 0x31, 0x39, 0x7A, 0x78, 0x63, 0x76, 0x60,  // 30 B N M , . / RShift kp* LAlt Space Caps F1-F5
        0x61, 0x62, 0x64, 0x65, 0x6D, 0x47, -1,   0x59, 0x5B, 0x5C, 0x4E, 0x56, 0x57, 0x58, 0x45, 0x53,  // 40 F6-F10 NumLock Scroll kp7 8 9 - 4 5 6 + 1
        0x54, 0x55, 0x52, 0x41, -1,   -1,   0x0A,                                                        // 50 kp2 3 0 . - - ISO key next to left Shift
    };
}
