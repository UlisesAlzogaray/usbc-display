using System.Collections.Generic;
using System.Text.Json;

namespace UsbcSetup;

// The snapshot the wizard UI renders from (CONTRACT.md section 2). Field names become camelCase.
// Fields marked "extra" are additions to the contract; the UI may ignore them.
sealed class State
{
    public string Type = "state";
    public LaptopState Laptop = new();
    public LinkState Link = new();
    public ServerState Server = new();
    public MacState Mac = new();
    public ScreenState Screen = new();
    public SettingsState Settings = new();
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
    public string Elevation = "none";        // none | pending | done | refused | failed
    public bool FirewallOk, RecoveryTasksOk;
    public List<string> MissingPayload = new();  // extra: payload files this build doesn't carry
    public string InstallError = "";         // extra: why "install" failed, in plain words
    public bool Installing;                  // extra: the install is running now
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
    // System Settings is), how many times it left since the download finished, and whether its
    // settings button was clicked.
    public bool PageFocused = true, SettingsOpened;
    public int PageBlurs;
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
}

sealed class ScreenState
{
    public bool Running, Showing;
    public bool PointerOnLaptop = false;     // not reported by the receiver yet: always false
    public string Error = "";                // extra: why "startScreen" couldn't start it
}

sealed class SettingsState
{
    public List<ScaleOption> ScaleOptions = new();
    public int Scale = 125;
    public bool MatchColors = true, UseLaptopInput = true;
}

sealed class ScaleOption
{
    public int Id;
    public string Label = "", Detail = "";
    public bool Recommended;
}
