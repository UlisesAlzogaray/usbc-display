using System;
using System.Runtime.InteropServices;
using System.Threading.Tasks;

namespace UsbcDisplay;

// Windows' built-in H.264 decoder (Media Foundation MFT) in low-latency mode: every
// access unit that goes in comes straight back out as a picture. Output is NV12,
// converted to BGRA on the CPU in parallel. COM is called by vtable slot, like Renderer.
unsafe sealed class H264Decoder : IDisposable
{
    static readonly Guid CLSID_MSH264DecoderMFT = new("62CE7E72-4C71-4D20-B15D-452831A87D9D");
    static readonly Guid IID_IMFTransform = new("bf94c121-5b05-4e6f-8000-ba598961414d");
    static readonly Guid MFMediaType_Video = new("73646976-0000-0010-8000-00AA00389B71");
    static readonly Guid MFVideoFormat_H264 = new("34363248-0000-0010-8000-00AA00389B71");
    static readonly Guid MFVideoFormat_NV12 = new("3231564E-0000-0010-8000-00AA00389B71");
    static readonly Guid MF_MT_MAJOR_TYPE = new("48eba18e-f8c9-4687-bf11-0a74c9f96a8f");
    static readonly Guid MF_MT_SUBTYPE = new("f7e34c9a-42e8-4714-b74b-cb29d72c35e5");
    static readonly Guid MF_MT_FRAME_SIZE = new("1652c33d-d6b2-4012-b834-72030849a37d");
    static readonly Guid MF_MT_DEFAULT_STRIDE = new("644b4e48-1e02-4516-b0eb-c01ca9d49ac6");
    static readonly Guid MF_MT_INTERLACE_MODE = new("e2724bb8-e676-4806-b4b2-a8d6efb44ccd");
    static readonly Guid MF_LOW_LATENCY = new("9c27891a-ed7a-40e1-88e8-b22727a024ee");

    const int MF_E_TRANSFORM_NEED_MORE_INPUT = unchecked((int)0xC00D6D72);
    const int MF_E_TRANSFORM_STREAM_CHANGE = unchecked((int)0xC00D6D61);
    const int MF_E_NOTACCEPTING = unchecked((int)0xC00D36B5);
    const uint MFT_OUTPUT_STREAM_PROVIDES_SAMPLES = 0x100;

    [StructLayout(LayoutKind.Sequential)]
    struct OutputStreamInfo { public uint Flags, Size, Alignment; }

    [StructLayout(LayoutKind.Sequential)]
    struct OutputDataBuffer { public uint StreamId; public void* Sample; public uint Status; public void* Events; }

    [DllImport("ole32.dll")] static extern int CoInitializeEx(IntPtr reserved, uint coinit);
    [DllImport("ole32.dll")] static extern int CoCreateInstance(Guid* clsid, IntPtr outer, uint context, Guid* iid, void** obj);
    [DllImport("mfplat.dll")] static extern int MFStartup(uint version, uint flags);
    [DllImport("mfplat.dll")] static extern int MFCreateMediaType(void** type);
    [DllImport("mfplat.dll")] static extern int MFCreateSample(void** sample);
    [DllImport("mfplat.dll")] static extern int MFCreateMemoryBuffer(uint maxLength, void** buffer);

    public static bool Verbose;
    static void Log(string m) { if (Verbose) Console.WriteLine("  [decoder] " + m); }

    static bool started;
    readonly int width, height;
    void* mft, outSample;
    bool mftProvidesSamples;
    int outPitch, outHeight;
    long time;

    static void** Vt(void* o) => *(void***)o;
    static void Release(void* o) { if (o != null) ((delegate* unmanaged<void*, uint>)Vt(o)[2])(o); }
    static void Check(int hr, string what) { if (hr < 0) throw new InvalidOperationException($"{what} failed (0x{hr:X8})"); }

    // IMFAttributes / IMFMediaType slots
    static int SetUINT32(void* a, Guid key, uint v) => ((delegate* unmanaged<void*, Guid*, uint, int>)Vt(a)[21])(a, &key, v);
    static int SetUINT64(void* a, Guid key, ulong v) => ((delegate* unmanaged<void*, Guid*, ulong, int>)Vt(a)[22])(a, &key, v);
    static int SetGUID(void* a, Guid key, Guid v) => ((delegate* unmanaged<void*, Guid*, Guid*, int>)Vt(a)[24])(a, &key, &v);
    static int GetUINT32(void* a, Guid key, uint* v) => ((delegate* unmanaged<void*, Guid*, uint*, int>)Vt(a)[7])(a, &key, v);
    static int GetUINT64(void* a, Guid key, ulong* v) => ((delegate* unmanaged<void*, Guid*, ulong*, int>)Vt(a)[8])(a, &key, v);
    static int GetGUID(void* a, Guid key, Guid* v) => ((delegate* unmanaged<void*, Guid*, Guid*, int>)Vt(a)[10])(a, &key, v);
    // IMFSample slots
    static int SetSampleTime(void* s, long t) => ((delegate* unmanaged<void*, long, int>)Vt(s)[36])(s, t);
    static int GetBufferByIndex(void* s, uint i, void** b) => ((delegate* unmanaged<void*, uint, void**, int>)Vt(s)[40])(s, i, b);
    static int AddBuffer(void* s, void* b) => ((delegate* unmanaged<void*, void*, int>)Vt(s)[42])(s, b);
    // IMFMediaBuffer slots
    static int Lock(void* b, byte** p, uint* max, uint* cur) => ((delegate* unmanaged<void*, byte**, uint*, uint*, int>)Vt(b)[3])(b, p, max, cur);
    static int Unlock(void* b) => ((delegate* unmanaged<void*, int>)Vt(b)[4])(b);
    static int SetCurrentLength(void* b, uint n) => ((delegate* unmanaged<void*, uint, int>)Vt(b)[6])(b, n);

    public H264Decoder(int width, int height)
    {
        this.width = width;
        this.height = height;
        if (!started)
        {
            CoInitializeEx(IntPtr.Zero, 0);  // multithreaded apartment
            Check(MFStartup(0x00020070, 0), "MFStartup");
            started = true;
        }
        Guid clsid = CLSID_MSH264DecoderMFT, iid = IID_IMFTransform;
        void* t;
        Check(CoCreateInstance(&clsid, IntPtr.Zero, 1, &iid, &t), "creating the H.264 decoder");
        mft = t;

        void* attrs;
        if (((delegate* unmanaged<void*, void**, int>)Vt(mft)[8])(mft, &attrs) >= 0 && attrs != null)  // GetAttributes
        {
            SetUINT32(attrs, MF_LOW_LATENCY, 1);
            Release(attrs);
        }

        void* type;
        Check(MFCreateMediaType(&type), "MFCreateMediaType");
        SetGUID(type, MF_MT_MAJOR_TYPE, MFMediaType_Video);
        SetGUID(type, MF_MT_SUBTYPE, MFVideoFormat_H264);
        SetUINT64(type, MF_MT_FRAME_SIZE, (ulong)width << 32 | (uint)height);
        SetUINT32(type, MF_MT_INTERLACE_MODE, 2);  // progressive
        int hr = ((delegate* unmanaged<void*, uint, void*, uint, int>)Vt(mft)[15])(mft, 0, type, 0);  // SetInputType
        Release(type);
        Check(hr, "SetInputType");
        ChooseOutputType();

        ((delegate* unmanaged<void*, uint, nuint, int>)Vt(mft)[23])(mft, 0x10000000, 0);  // NOTIFY_BEGIN_STREAMING
        ((delegate* unmanaged<void*, uint, nuint, int>)Vt(mft)[23])(mft, 0x10000003, 0);  // NOTIFY_START_OF_STREAM
    }

    void ChooseOutputType()
    {
        for (uint i = 0; ; i++)
        {
            void* type;
            int hr = ((delegate* unmanaged<void*, uint, uint, void**, int>)Vt(mft)[14])(mft, 0, i, &type);  // GetOutputAvailableType
            Check(hr, "GetOutputAvailableType (no NV12 output)");
            Guid sub;
            GetGUID(type, MF_MT_SUBTYPE, &sub);
            if (sub != MFVideoFormat_NV12) { Release(type); continue; }

            hr = ((delegate* unmanaged<void*, uint, void*, uint, int>)Vt(mft)[16])(mft, 0, type, 0);  // SetOutputType
            ulong size;
            uint stride;
            outHeight = GetUINT64(type, MF_MT_FRAME_SIZE, &size) >= 0 ? (int)(uint)size : height;
            int outWidth = GetUINT64(type, MF_MT_FRAME_SIZE, &size) >= 0 ? (int)(size >> 32) : width;
            outPitch = GetUINT32(type, MF_MT_DEFAULT_STRIDE, &stride) >= 0 ? (int)stride : outWidth;
            Release(type);
            Log($"output type #{i}: NV12 {outWidth}x{outHeight}, stride {outPitch}, SetOutputType 0x{hr:X8}");
            Check(hr, "SetOutputType");
            break;
        }

        OutputStreamInfo info;
        Check(((delegate* unmanaged<void*, uint, OutputStreamInfo*, int>)Vt(mft)[7])(mft, 0, &info), "GetOutputStreamInfo");
        mftProvidesSamples = (info.Flags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES) != 0;
        Log($"output stream info: flags 0x{info.Flags:X}, size {info.Size}, alignment {info.Alignment}");
        Release(outSample);
        outSample = null;
        if (!mftProvidesSamples)
        {
            void* s, b;
            Check(MFCreateSample(&s), "MFCreateSample");
            Check(MFCreateMemoryBuffer(Math.Max(info.Size, (uint)(outPitch * outHeight * 3 / 2)), &b), "MFCreateMemoryBuffer");
            AddBuffer(s, b);
            Release(b);
            outSample = s;
        }
    }

    // Decodes one access unit; returns true when a new picture was written to bgra (width*height*4).
    public bool Decode(byte* data, int length, byte* bgra)
    {
        void* buf, sample;
        Check(MFCreateMemoryBuffer((uint)length, &buf), "MFCreateMemoryBuffer");
        byte* p;
        uint max, cur;
        Lock(buf, &p, &max, &cur);
        Buffer.MemoryCopy(data, p, length, length);
        Unlock(buf);
        SetCurrentLength(buf, (uint)length);
        MFCreateSample(&sample);
        AddBuffer(sample, buf);
        Release(buf);
        SetSampleTime(sample, time);
        time += 166_667;  // 100 ns units; the decoder only needs them increasing

        bool produced = false;
        int hr = ProcessInput(sample);
        Log($"ProcessInput {length} bytes: 0x{hr:X8}");
        if (hr == MF_E_NOTACCEPTING)
        {
            produced = Drain(bgra);
            hr = ProcessInput(sample);
        }
        Release(sample);
        Check(hr, "ProcessInput");
        return Drain(bgra) | produced;
    }

    int ProcessInput(void* sample) => ((delegate* unmanaged<void*, uint, void*, uint, int>)Vt(mft)[24])(mft, 0, sample, 0);

    bool Drain(byte* bgra)
    {
        bool produced = false;
        for (;;)
        {
            if (!mftProvidesSamples)
            {
                void* ob0;
                if (GetBufferByIndex(outSample, 0, &ob0) >= 0) { SetCurrentLength(ob0, 0); Release(ob0); }
            }
            var ob = new OutputDataBuffer { Sample = mftProvidesSamples ? null : outSample };
            uint status;
            int hr = ((delegate* unmanaged<void*, uint, uint, OutputDataBuffer*, uint*, int>)Vt(mft)[25])(mft, 0, 1, &ob, &status);
            Log($"ProcessOutput 0x{hr:X8}, buffer status 0x{ob.Status:X}");
            Release(ob.Events);
            if (hr == MF_E_TRANSFORM_NEED_MORE_INPUT) return produced;
            if (hr == MF_E_TRANSFORM_STREAM_CHANGE) { ChooseOutputType(); continue; }
            Check(hr, "ProcessOutput");

            void* b;
            Check(GetBufferByIndex(ob.Sample, 0, &b), "GetBufferByIndex");
            byte* p;
            uint max, cur;
            Lock(b, &p, &max, &cur);
            Nv12ToBgra(p, p + (long)outPitch * outHeight, outPitch, bgra, width, height);
            Unlock(b);
            Release(b);
            if (mftProvidesSamples) Release(ob.Sample);
            produced = true;
        }
    }

    // BT.709 limited range (what VideoToolbox produces) to BGRA, rows split across cores.
    static void Nv12ToBgra(byte* yPlane, byte* uvPlane, int pitch, byte* dst, int w, int h)
    {
        nint yp = (nint)yPlane, uvp = (nint)uvPlane, dp = (nint)dst;
        int bands = Math.Max(1, Math.Min(Environment.ProcessorCount, h / 16));
        int rowsPerBand = (h / bands + 1) & ~1;
        Parallel.For(0, bands, band =>
        {
            int y0 = band * rowsPerBand, y1 = Math.Min(h, y0 + rowsPerBand);
            for (int row = y0; row < y1; row++)
            {
                byte* yr = (byte*)yp + (long)row * pitch;
                byte* uvr = (byte*)uvp + (long)(row >> 1) * pitch;
                uint* o = (uint*)((byte*)dp + (long)row * w * 4);
                for (int x = 0; x < w; x += 2)
                {
                    int u = uvr[x] - 128, v = uvr[x + 1] - 128;
                    int rv = 459 * v + 128, guv = -55 * u - 136 * v + 128, bu = 541 * u + 128;
                    int c = (yr[x] - 16) * 298;
                    o[x] = 0xFF000000u | (uint)Clamp((c + rv) >> 8) << 16 | (uint)Clamp((c + guv) >> 8) << 8 | (uint)Clamp((c + bu) >> 8);
                    if (x + 1 < w)
                    {
                        c = (yr[x + 1] - 16) * 298;
                        o[x + 1] = 0xFF000000u | (uint)Clamp((c + rv) >> 8) << 16 | (uint)Clamp((c + guv) >> 8) << 8 | (uint)Clamp((c + bu) >> 8);
                    }
                }
            }
        });
    }

    static int Clamp(int v) => v < 0 ? 0 : v > 255 ? 255 : v;

    public void Dispose()
    {
        Release(outSample);
        Release(mft);
        outSample = mft = null;
    }
}
