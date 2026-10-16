// Every word the setup window shows (SPEC §3 and §5), keyed screen.sub.part (a part shared by every
// sub-state of a screen leaves the sub out, e.g. connect.title). view() in steps.js reads only from
// here and fills {name} placeholders. <b> marks the name of the thing to click.
// English only for now; a second table (es-419) can sit next to this one later.
(function () {
  'use strict';
  const D = (window.USBC = window.USBC || {});

  D.STR = {
    // ---------- Buttons and shared words ----------
    'common.continue': 'Continue',
    'common.cancel': 'Cancel',
    'common.quit': 'Quit',
    'common.tryAgain': 'Try Again',
    'common.notNow': 'Not Now',
    'common.openSettings': 'Open System Settings',
    'common.moveToApps': 'Move to Applications',
    'common.done': 'Done',
    'common.returnToWindows': 'Return to Windows',
    'common.showMacDesktop': 'Show Mac Desktop',
    'common.learnMore': 'Learn More…',
    'common.close': 'Close',
    'common.minimize': 'Minimize',
    'common.edge.right': 'right',
    'common.edge.left': 'left',
    'common.edge.top': 'top',
    'common.edge.bottom': 'bottom',
    'common.progress': '{sent} of {size}',
    'common.mb': '{n} MB',

    // ---------- Status line (bottom left) ----------
    'status.installing': 'Installing…',
    'status.installed': 'Installed',
    'status.waitingWindows': 'Waiting for Windows…',
    'status.pendingAdmin': 'Waiting for you to click Yes…',
    'status.pendingStandard': 'Waiting for an administrator…',
    'status.settingUpPc': 'Setting up this PC…',
    'status.pcReady': 'This PC is ready',
    'status.lookingForMac': 'Looking for your Mac…',
    'status.connecting': 'Connecting to your Mac…',
    'status.waitingMac': 'Waiting for your Mac…',
    'status.downloading': 'Downloading…',
    'status.downloaded': 'Downloaded',
    'status.settingUpApp': 'Setting up USB-C Display…',
    'status.moving': 'Moving USB-C Display…',
    'status.reopening': 'Reopening USB-C Display…',
    'status.extending': 'Extending your Mac desktop…',
    'status.extended': 'Desktop extended',

    // ---------- welcome ----------
    'welcome.idle.title': 'Use This PC as a Display',
    'welcome.idle.p1': 'USB-C Display lets you extend your Mac desktop onto this Windows PC with a single Thunderbolt or USB4 cable.',
    'welcome.idle.p2-admin': 'To continue, make sure your Mac is nearby and unlocked.',
    // SPEC: “To continue, you’ll need your Mac nearby and an administrator of this PC.” wraps to a second line
    // (5 body lines, the limit is 4, §10.2.5); this keeps both requirements on one line.
    'welcome.idle.p2-standard': 'You’ll need your Mac and an administrator of this PC.',

    // ---------- unsupported, incomplete ----------
    'unsupported.idle.title': 'Unable to Use This PC as a Display',
    'unsupported.idle.body': 'USB-C Display needs a Thunderbolt or USB4 port, and none was found on this PC. Nothing was installed.',
    'unsupported.idle.caption': 'If this PC does have one, connect your Mac with the cable to continue.',
    'incomplete.idle.title': 'Unable to Set Up USB-C Display',
    'incomplete.idle.body': 'This copy of USB-C Display Setup is missing some of its files. Download it again, then open the new copy.',

    // ---------- install-error ----------
    'install-error.title': 'Unable to Install USB-C Display',
    'install-error.in-use.body': 'Another copy of USB-C Display is open. Quit it, then click <b>Try Again</b>.',
    'install-error.other.body': 'Nothing was changed on this PC. Click <b>Try Again</b>, and if that doesn’t work, restart this PC and open USB-C Display Setup again.',

    // ---------- allow-pc ----------
    'allow-pc.title': 'Allow Changes on This PC',
    'allow-pc.body.admin-unsigned': 'When Windows asks about an app from an unknown publisher, click <b>Yes</b>. This lets your Mac get USB-C Display from this PC through the cable.',
    'allow-pc.body.admin-signed': 'When Windows asks, click <b>Yes</b>. This lets your Mac get USB-C Display from this PC through the cable.',
    'allow-pc.body.standard': 'When Windows asks, an administrator of this PC needs to enter their name and password, then click <b>Yes</b>. This lets your Mac get USB-C Display from this PC through the cable.',
    'allow-pc.pending-hint.body': 'If you don’t see the request, click the flashing shield icon in the taskbar, then click <b>Yes</b>. This lets your Mac get USB-C Display from this PC through the cable.',
    'allow-pc.pending-hint.body-standard': 'If you don’t see the request, click the flashing shield icon in the taskbar. An administrator of this PC needs to enter their name and password, then click <b>Yes</b>.',
    'allow-pc.ask.body': 'Click <b>Continue</b>, then click <b>Yes</b> when Windows asks. This lets your Mac get USB-C Display from this PC through the cable.',
    'allow-pc.ask.body-standard': 'Click <b>Continue</b>. When Windows asks, an administrator of this PC needs to enter their name and password, then click <b>Yes</b>.',
    'allow-pc.refused.title': 'Changes Not Allowed',
    'allow-pc.refused.body': 'Your Mac can’t get USB-C Display from this PC without your permission. Click <b>Try Again</b>, then click <b>Yes</b> when Windows asks.',
    'allow-pc.refused.body-standard': 'Your Mac can’t get USB-C Display from this PC without an administrator’s permission. Click <b>Try Again</b>, then have an administrator enter their name and password.',
    'allow-pc.failed.title': 'Unable to Make Changes on This PC',
    'allow-pc.failed.body': 'Windows didn’t complete the changes. Click <b>Try Again</b>, then click <b>Yes</b> when Windows asks.',
    'allow-pc.working.body': 'There’s nothing more to click in Windows. This PC is getting ready for your Mac.',

    // ---------- connect ----------
    'connect.title': 'Connect Your Mac',
    'connect.caption': 'Look for a lightning bolt or “40” on the cable’s plugs and next to the ports. Phone and charging cables usually won’t work.',
    'connect.cable.body': 'Connect this PC to your Mac with a Thunderbolt or USB4 cable. If your Mac asks to allow the accessory to connect, click <b>Allow</b>.',
    'connect.cable-hint.body': 'Connect this PC to your Mac with a Thunderbolt or USB4 cable. Make sure your Mac is unlocked, and if it asks to allow the accessory to connect, click <b>Allow</b>.',
    'connect.no-cable.title': 'Cable Not Detected',
    'connect.no-cable.body': 'Make sure the cable is connected to a Thunderbolt or USB4 port on both computers and that your Mac is unlocked. If that doesn’t help, try another cable.',
    'connect.reconnect.body': 'The cable was disconnected. Connect it again to continue where you left off.',
    'connect.finding.body': 'Keep your Mac unlocked and the cable connected.',
    'connect.no-mac.title': 'Unable to Connect to Your Mac',
    'connect.no-mac.body': 'Make sure your Mac is awake and unlocked. Then disconnect the cable, wait a few seconds, and connect it again.',
    'connect.no-server.title': 'Unable to Connect to Your Mac',
    'connect.no-server.body': 'This PC isn’t ready to share USB-C Display with your Mac. Click <b>Try Again</b>, then click <b>Yes</b> if Windows asks.',
    'connect.no-server.body-standard': 'This PC isn’t ready to share USB-C Display with your Mac. Click <b>Try Again</b>, then have an administrator enter their name and password if Windows asks.',
    'connect.port-busy.title': 'Unable to Connect to Your Mac',
    'connect.port-busy.body': 'Another app on this PC is using the connection USB-C Display needs. Restart this PC, then open USB-C Display Setup again.',

    // ---------- unreachable ----------
    'unreachable.title': 'Unable to Connect to Your Mac',
    'unreachable.body': 'Make sure your Mac is awake and unlocked. Setup continues when your Mac responds.',

    // ---------- get-app ----------
    'get-app.title': 'Get USB-C Display on Your Mac',
    'get-app.title-update': 'Update USB-C Display on Your Mac',
    'get-app.address.body': 'On your Mac, open Safari, type this address, then press Return.',
    'get-app.address.body-update': 'To update USB-C Display, open Safari on your Mac, type this address, then press Return.',
    // One line with Learn More… (§10.2.5: with the Update body the SPEC wording ends the content at y 523.5).
    'get-app.address-hint.caption': 'If you see search results, enter “http://{host}” instead.',
    'get-app.address-ip.caption': 'If the page doesn’t open, enter “{fallback}” instead.',
    'get-app.download.body': 'On the USB-C Display page, click <b>Download</b>.',
    'get-app.download-hint.caption': 'If nothing happens, reload the page, then click Download again.',
    'get-app.allow-downloads.body': 'When Safari asks to allow downloads on “{host},” click <b>Allow</b>.',
    'get-app.downloading.body': 'Your Mac is downloading USB-C Display from this PC.',

    // ---------- open-app ----------
    'open-app.title': 'Open USB-C Display on Your Mac',
    'open-app.downloads.body': 'In Safari, click the Downloads button at the top right, then double-click <b>USB-C Display</b>.',
    'open-app.downloads.caption': 'When your Mac says it can’t verify the app, click <b>Done</b>, not Move to Trash.',
    'open-app.confirm.body': 'When your Mac asks if you’re sure, click <b>Open</b>.',
    'open-app.not-opened.body': 'Click <b>Done</b>, then click <b>Open Privacy &amp; Security</b> on the USB-C Display page in Safari.',
    'open-app.not-opened.caption': 'Your Mac shows this for apps that Apple hasn’t verified. USB-C Display came from this PC through the cable.',
    'open-app.page-button.body': 'In Safari, click <b>Open Privacy &amp; Security</b> on the USB-C Display page.',
    'open-app.page-button.caption': 'If you clicked Move to Trash, click Download Again on the page instead.',
    'open-app.safari-allow.body': 'When Safari asks to open System Settings, click <b>Allow</b>.',
    'open-app.open-anyway.body': 'Click <b>Open Anyway</b>. When your Mac asks again, click <b>Open Anyway</b> and use Touch ID or enter your password.',
    'open-app.open-anyway.caption': 'Then USB-C Display sets itself up. If your Mac shows “Login Item Added,” there’s nothing to click.',
    'open-app.setting-up.body': 'USB-C Display is setting itself up on your Mac.',
    'open-app.setting-up.caption': 'If your Mac shows “Login Item Added,” there’s nothing to click.',
    'open-app.setting-up-late.body': 'On your Mac, open USB-C Display from the Applications folder.',

    // ---------- move ----------
    'move.title': 'Move USB-C Display to Applications',
    'move.idle.body': 'USB-C Display needs to be in the Applications folder on your Mac so it’s ready whenever you connect this PC. Click <b>Move to Applications</b>.',
    'move.moving.body': 'USB-C Display needs to be in the Applications folder on your Mac so it’s ready whenever you connect this PC. If your Mac asks for your password, enter it.',
    'move.failed.title': 'Unable to Move USB-C Display',
    'move.failed.body': 'On your Mac, drag USB-C Display from Downloads to Applications, then open it from there.',

    // ---------- login ----------
    'login.title': 'Allow USB-C Display in the Background',
    'login.caption': 'This lets USB-C Display be ready whenever you connect this PC.',
    'login.settings.body': 'Under Background App Activity, turn on <b>USB-C Display</b>.',
    'login.asking.body': 'Click <b>Open System Settings</b>, then turn on <b>USB-C Display</b> on your Mac.',

    // ---------- allow-screen ----------
    'allow-screen.title': 'Allow Screen Recording on Your Mac',
    'allow-screen.caption': 'USB-C Display uses screen recording only to show your Mac desktop on this PC. Nothing is saved, and no audio is sent.',
    'allow-screen.prompt.body': 'On your Mac, click <b>Open System Settings</b>.',
    'allow-screen.settings.body': 'Turn on <b>USB-C Display</b>, then use Touch ID or enter your password.',
    'allow-screen.reopen.body': 'If your Mac asks, click <b>Quit &amp; Reopen</b>.',
    'allow-screen.reopen-late.body': 'Click <b>Try Again</b> to reopen USB-C Display on your Mac.',
    'allow-screen.off.body': 'Screen recording is off for USB-C Display. Click <b>Open System Settings</b>, then turn on <b>USB-C Display</b> on your Mac.',

    // ---------- keyboard ----------
    'keyboard.offer.title': 'Use This PC’s Keyboard and Trackpad',
    'keyboard.offer.body': 'You can control your Mac with the keyboard and trackpad on this PC. Your Mac asks for permission first.',

    // ---------- allow-control ----------
    'allow-control.title': 'Allow Device Control on Your Mac',
    'allow-control.caption': 'USB-C Display uses this only so this PC’s keyboard and trackpad can control your Mac. Nothing else is controlled or recorded.',
    'allow-control.prompt.body': 'On your Mac, click <b>Open System Settings</b>.',
    'allow-control.settings.body': 'Turn on <b>USB-C Display</b>, then use Touch ID or enter your password.',
    'allow-control.off.body': 'Device control is off for USB-C Display. Click <b>Open System Settings</b>, then turn on <b>USB-C Display</b> on your Mac.',

    // ---------- ready ----------
    'ready.title': 'USB-C Display Is Ready to Use',
    'ready.list.escape.title': 'Return to Windows',
    'ready.list.escape.text': 'Press Ctrl-Alt-Esc at any time, or disconnect the cable.',
    'ready.list.plug.title': 'Connect Anytime',
    'ready.list.plug.text': 'Whenever you connect the cable, your Mac desktop appears on this PC.',
    'ready.list.keyboard.title': 'Use This PC’s Keyboard',
    'ready.list.keyboard.text': 'Alt works as Command, and the Windows key works as Option.',
    'ready.starting.body': 'Your Mac desktop is about to extend onto this PC.',
    'ready.showing.body-input': 'You’re all set. This PC’s keyboard and trackpad now work with your Mac, so you can click <b>Done</b> right here.',
    'ready.showing.body-edge': 'You’re all set. Use your Mac’s trackpad or mouse to move the pointer past the {edge} edge of your Mac’s screen and onto this PC, then click <b>Done</b>.',
    'ready.showing.body-noedge': 'You’re all set. Use your Mac’s trackpad or mouse to move the pointer onto this PC, then click <b>Done</b>.',
    'ready.showing.body-pointer': 'You’re all set. You can drag windows from your Mac onto this PC, then click <b>Done</b>.',
    'ready.hidden.body': 'You’re all set. To show your Mac desktop on this PC again, click <b>Show Mac Desktop</b>.',
    'ready.manual.body': 'Click <b>Show Mac Desktop</b> to extend your Mac desktop onto this PC.',
    'ready.elsewhere.body': 'Your Mac desktop is already showing on this PC. To return to Windows, press Ctrl-Alt-Esc.',
    'ready.error.title': 'Unable to Show Your Mac Desktop',
    'ready.error.body': 'Make sure your Mac is unlocked and the cable is connected, then click <b>Try Again</b>.',
    'ready.error-files.title': 'Unable to Show Your Mac Desktop',
    'ready.error-files.body': 'Some USB-C Display files are missing on this PC. Download USB-C Display Setup again, then open it.',

    // ---------- Sheets (Learn More…) ----------
    'sheet.permission.title': 'About This Permission',
    'sheet.permission.p1': 'USB-C Display adds Windows Firewall rules so your Mac can download USB-C Display from this PC and find it by name. The rules apply only to the cable, so Wi-Fi and internet connections aren’t affected.',
    'sheet.permission.p2': 'It also adds two tasks that restart the cable connection if it stops responding. Removing USB-C Display removes all of these changes.',
    'sheet.permission.p3': 'Windows shows the publisher as Unknown because this copy of USB-C Display Setup isn’t signed yet.',

    'sheet.cable.title': 'Use a Thunderbolt or USB4 Cable',
    'sheet.cable.p1': 'USB-C Display works with a Thunderbolt or USB4 cable connected to a Thunderbolt or USB4 port on both computers. These ports and cables are often marked with a lightning bolt or “40.”',
    'sheet.cable.p2': 'Phone and charging cables usually won’t work, even though they fit. If nothing happens, try another cable or another port.',
    'sheet.cable.p3': 'If you clicked Don’t Allow when your Mac asked about the accessory, open System Settings &gt; Privacy &amp; Security &gt; Accessories on your Mac, set “Allow accessories to connect” to “Ask for new accessories,” then connect the cable again.',

    'sheet.mac-connect.title': 'If Your Mac Doesn’t Connect',
    'sheet.mac-connect.p1': 'Make sure your Mac is awake and unlocked.',
    'sheet.mac-connect.p2': 'On your Mac, quit any VPN or network filter apps, then disconnect the cable and connect it again.',
    'sheet.mac-connect.p3': 'On your Mac, open System Settings &gt; Network and make sure Thunderbolt Bridge is connected. If it still doesn’t connect, restart your Mac.',

    'sheet.mac-respond.title': 'If Your Mac Doesn’t Respond',
    'sheet.mac-respond.p1': 'Make sure your Mac is awake and unlocked.',
    'sheet.mac-respond.p2': 'If you quit USB-C Display, open it again from the Applications folder on your Mac.',
    'sheet.mac-respond.p3': 'Disconnect the cable, then connect it again. If that doesn’t help, restart your Mac.',

    'sheet.safari.title': 'If the Page Doesn’t Open',
    'sheet.safari.p1': 'Safari is the compass icon in the Dock. Enter the address in the address bar at the top of its window.',
    'sheet.safari.p2': 'If you see search results, enter “http://{host}” instead. If the page still doesn’t open, enter “{fallback}” instead.',
    'sheet.safari.p2-nofallback': 'If you see search results, enter “http://{host}” instead.',
    'sheet.safari.p3': 'On your Mac, quit any VPN apps for now, and make sure the cable is still connected.',

    'sheet.gatekeeper.title': 'About Opening USB-C Display',
    'sheet.gatekeeper.p1': 'Your Mac checks every app before it opens it. USB-C Display isn’t verified by Apple yet, so your Mac asks you to allow it in Privacy &amp; Security.',
    'sheet.gatekeeper.p2': 'USB-C Display came from this PC through the cable, not from the internet.',
    'sheet.gatekeeper.p3': 'If you clicked Move to Trash, click Download Again on the USB-C Display page in Safari, then open it again.',

    'sheet.open-anyway.title': 'If You Don’t See Open Anyway',
    'sheet.open-anyway.p1': 'On your Mac, open System Settings &gt; Privacy &amp; Security and scroll down to Security. Open Anyway is there for about an hour after you try to open the app.',
    'sheet.open-anyway.p2': 'If you clicked Move to Trash, click Download Again on the USB-C Display page in Safari, then open it again.',
    'sheet.open-anyway.p3': 'If your Mac asks for your password or about incoming network connections, enter your password or click Allow.',

    'sheet.screen.title': 'About Screen Recording',
    'sheet.screen.p1': 'USB-C Display records only the display it adds for this PC and sends it directly through the cable. Nothing is saved, and no audio is sent.',
    'sheet.screen.p2': 'From time to time, your Mac may ask whether USB-C Display can keep accessing your screen. To keep using this PC as a display, click Allow.',
    'sheet.screen.p3': 'You can turn this off at any time in System Settings &gt; Privacy &amp; Security &gt; Screen &amp; System Audio Recording.',

    'sheet.control.title': 'About Keyboard and Trackpad Control',
    'sheet.control.p1': 'With this permission, this PC’s keyboard and trackpad can control your Mac while your Mac desktop is on this PC. Nothing else is controlled or recorded.',
    'sheet.control.p2': 'On this PC’s keyboard, Alt works as Command, and the Windows key works as Option.',
    'sheet.control.p3': 'You can turn this off at any time in System Settings &gt; Privacy &amp; Security &gt; Device Control and Data Access.',

    'sheet.desktop.title': 'If Your Mac Desktop Doesn’t Appear',
    'sheet.desktop.p1': 'Make sure your Mac is unlocked and the cable is connected.',
    'sheet.desktop.p2': 'On your Mac, make sure USB-C Display is turned on in System Settings &gt; Privacy &amp; Security &gt; Screen &amp; System Audio Recording.',
    'sheet.desktop.p3': 'Disconnect the cable, connect it again, then click Try Again.',
  };
})();
