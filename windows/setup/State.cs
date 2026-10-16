using System.Collections.Generic;
using System.Text.Json;

namespace UsbcSetup;

// The snapshot the wizard UI renders from (CONTRACT.md section 2). Field names become camelCase.
// The UI is a pure function of this snapshot and its own place in the steps.
sealed class State
{
    public string Type = "state";
    public LaptopState Laptop = new();
    public LinkState Link = new();
    public ServerState Server = new();
    public MacState Mac = new();
    public ScreenState Screen = new();
    public SettingsState Settings = new();
    public SetupState Setup = new();
    public bool SetupDone;

    static readonly JsonSerializerOptions Options = new()
    {
        IncludeFields = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public string ToJson() => JsonSerializer.Serialize(this, Options);
}

sealed class LaptopState
{
    public int WindowsBuild;
    public string Arch = "";
    public bool IsAdminUser;
    public string Usb4 = "unknown";          // ok | missing | unknown
    public bool Installed;
    public string Elevation = "none";        // none | pending | working | done | refused | failed
    public bool FirewallOk, RecoveryTasksOk;
    public List<string> MissingPayload = new();  // payload files this build doesn't carry
    public string InstallError = "";         // '' | inUse | other (the details go to the log)
    public bool Installing;                  // the install is running now
    public bool Checked;                     // the USB4, firewall and task checks are done (the window may show)
    public bool RunningInstalled;            // this is the installed copy (the one the firewall rule names)
    public bool Signed;                      // this exe has a valid Authenticode signature (UAC shows a publisher)
}

sealed class LinkState
{
    public bool AdapterUp;
    public string AdapterName = "";
    public int SecondsSincePlug;
    public bool MacFound;
    public string MacV6 = "", MacV4 = "", LaptopV4 = "";
}

sealed class ServerState
{
    public bool Running;
    public string Url = "http://usbc.local";
    public string FallbackUrl = "";
    public bool UrlReady, PageVisited;
    public DownloadState Download = new();
    public bool AppNotarized;
    // From the page in Safari: whether Safari is in front (it isn't while Gatekeeper's dialog or
    // System Settings is), how many times it left since the download finished, whether its
    // settings button was clicked, and whether Safari then lost the focus to System Settings.
    public bool PageFocused = true, SettingsOpened, LeftForSettings;
    public int PageBlurs;
    public bool DownloadClicked;             // the page's Download button was clicked (reset by a completed download)
    public bool AppOpened;                   // the Mac app said it was opened (optional ping, Mac app 5)
    public long AppSize;                     // bytes of the Mac app's zip (0 when this copy has none)
    public string AppVersion = "";           // the Mac app's CFBundleVersion, e.g. "5"
    public string PageAppearance = "", PageAccent = "";  // the Mac's look as Safari reports it: dark | light, purple | blue...
    public string Error = "";                // '' | port (port 80 on the cable is taken by another app)
}

sealed class DownloadState
{
    public long Sent, Size;
    public bool Done;
}

sealed class MacState
{
    public bool Reachable, Outdated;
    public string AppVersion = "", MacOS = "";
    public MacStatus Status = new();
    // The Mac's look, so the setup's pictures of it match: "dark"/"light", and the accent colour
    // ("purple", "blue"... "multicolor"). Empty until a Mac app 4 or later answers.
    public string Appearance = "", Accent = "";
}

sealed class MacStatus
{
    public bool ScreenOk, AxOk, ScreenPrompted, AxPrompted, LoginItemEnabled, LoginItemNeedsApproval,
                SessionActive, RunningAsAgent, InApplications, ScreenNeedsRelaunch,
                SettingsFront, PromptUp;  // System Settings in front, a macOS permission prompt up
    public bool AuthUp;                   // a password or Touch ID request is on screen (Mac app 5)
    public string DisplaySide = "";       // right | left | above | below | '' (this PC's display, Mac app 5, during a session)
}

sealed class ScreenState
{
    public bool Running, Showing;
    public bool PointerOnLaptop;             // the Mac's pointer has been on this display during this run
    public bool InputOk;                     // the Mac allows this PC's keyboard and trackpad (this run)
    public string Error = "";                // '' | screen-recording-off | receiver-missing | exited | other
}

sealed class SettingsState
{
    public List<ScaleOption> ScaleOptions = new();
    public int Scale = 125;
    public bool MatchColors = true, UseLaptopInput = false;
}

sealed class ScaleOption
{
    public int Id;
    public string Label = "", Detail = "";
    public bool Recommended;
}

// Where the person is in setup, kept by the host (HKCU\Software\USB-C Display), so a reload, a
// restart from the installed copy or a later run never goes back to Welcome.
sealed class SetupState
{
    public bool Started;                     // Continue was clicked (SetupStarted)
    public string AxChoice = "";             // '' | yes | no: the keyboard offer's answer (AxChoice 0/1/2)
    public bool LoginSkip;                   // Not Now on the login item screen (LoginSkip)
    public bool ElevationAsked;              // the host asked Windows once by itself (ElevationAsked)
    public bool HandingOff;                  // this copy is handing over to the installed copy (not saved)
    public HoldState Hold;                   // the installed copy's first frame, from --hold (not saved)
}

sealed class HoldState
{
    public string Screen = "", Sub = "", Status = "", Theme = "", Accent = "";
    // Whether the downloaded copy drew its window in front (its lights): the page draws this
    // until the hold ends, then the window's own active state, which the host keeps posting.
    public bool Active = true;

    // "screen|sub|status|theme|accent|active" (active 1 or 0; without it, 1), as the hand-off
    // passes it on the command line.
    public static HoldState Parse(string s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        var p = s.Split('|');
        if (p.Length < 2 || p[0].Trim() == "") return null;
        string At(int i) => i < p.Length ? p[i].Trim() : "";
        return new HoldState { Screen = At(0), Sub = At(1), Status = At(2), Theme = At(3), Accent = At(4), Active = At(5) != "0" };
    }

    public override string ToString() => $"{Screen}|{Sub}|{Status}|{Theme}|{Accent}|{(Active ? "1" : "0")}";
}
