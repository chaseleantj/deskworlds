using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;

namespace DeskworldsWallpaper;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            DeskworldsWallpaper.Program.Log(WallpaperForm.LogPath(), "AppDomain: " + e.ExceptionObject);
        Application.ThreadException += (_, e) => DeskworldsWallpaper.Program.Log(WallpaperForm.LogPath(), "Thread: " + e.Exception);
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);

        try
        {
            ApplicationConfiguration.Initialize();
            Application.Run(new WallpaperForm());
        }
        catch (Exception ex)
        {
            DeskworldsWallpaper.Program.Log(WallpaperForm.LogPath(), "Main: " + ex);
        }
    }

    internal static void Log(string path, string message)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.AppendAllText(path, DateTime.Now + "  " + message + Environment.NewLine);
        }
        catch { /* 日志失败时无更好的处理 */ }
    }
}

internal sealed class WallpaperForm : Form
{
    // 电池供电时停渲染（Mac 版同款策略），不需要可改 false
    private const bool SuspendOnBattery = true;

    private static readonly (string Name, string Path)[] Worlds =
    {
        ("河床", "scenes/riverscape/"),
        ("珊瑚礁", "scenes/reefscape/"),
        ("斗鱼", "scenes/bettascape/"),
        ("等离子球", "scenes/plasmascape/"),
        ("锦鲤池", "scenes/koiscape/"),
        ("篝火", "scenes/bonfirescape/"),
    };

    private StaticServer? _server;
    private WebView2? _web;
    private NotifyIcon? _tray;
    private ToolStripMenuItem? _pauseItem;

    private readonly System.Windows.Forms.Timer _powerTimer = new() { Interval = 2000 };
    private bool _suspended;
    private bool _sessionLocked;
    private bool _userPaused;
    private readonly bool _windowed = Environment.GetCommandLineArgs().Contains("--windowed");

    public WallpaperForm()
    {
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        Bounds = Screen.PrimaryScreen!.Bounds;
        ShowInTaskbar = false;

        var root = FindRepoRoot();
        if (root is null)
            throw new InvalidOperationException("未找到仓库根目录（index.html），请从仓库目录树内运行");

        _server = new StaticServer(root);
        _server.Start();

        _ = InitWebViewAsync(_server.Url + Worlds[0].Path);
        InitTray();

        _powerTimer.Tick += (_, _) => ApplyPowerState();
        _powerTimer.Start();

        WTSRegisterSessionNotification(Handle, 0); // 接收锁屏/解锁通知

        // 渲染层在图标之下收不到真实鼠标，用低级钩子把桌面上的鼠标事件转发给 WebView2
        // 委托必须存字段：方法组每次转换生成新实例，被 GC 回收后原生回调会崩溃
        if (!_windowed)
        {
            _mouseHookProc = MouseHookProc;
            _mouseHook = SetWindowsHookExW(WH_MOUSE_LL, _mouseHookProc, IntPtr.Zero, 0);
            _moveTimer.Tick += async (_, _) =>
            {
                if (!_movePending || _jsBusy || _web?.CoreWebView2 is null) return;
                _jsBusy = true;
                _movePending = false;
                var pt = _pendingMove;
                try
                {
                    ScreenToClient(Handle, ref pt);
                    // 物理像素 → CSS 像素（WebView2 内 devicePixelRatio = DeviceDpi/96）
                    var scale = 96.0 / DeviceDpi;
                    await _web.CoreWebView2.ExecuteScriptAsync(
                        $"(() => {{const x={pt.X * scale},y={pt.Y * scale};" +
                        "const el=document.elementFromPoint(x,y);if(!el)return;" +
                        "el.dispatchEvent(new PointerEvent('pointermove',{clientX:x,clientY:y,pointerType:'mouse',isPrimary:true,bubbles:true}));" +
                        "})();");
                }
                catch { /* 页面切换瞬间执行失败可忽略，下个 tick 会重试 */ }
                finally { _jsBusy = false; }
            };
            _moveTimer.Start();
        }
    }

    // ---- 桌面鼠标输入转发 ----
    private const int WH_MOUSE_LL = 14;
    private const uint WM_MOUSEMOVE = 0x200, WM_LBUTTONDOWN = 0x201, WM_LBUTTONUP = 0x202,
        WM_RBUTTONDOWN = 0x204, WM_RBUTTONUP = 0x205;

    private IntPtr _mouseHook;
    private LowLevelMouseProc? _mouseHookProc;
    private IntPtr _chromeInputHwnd; // WebView2 的 Chrome_RenderWidgetHostHWND
    private bool _leftDown, _rightDown;

    // 移动事件的 JS 派发通道：钩子里只记坐标，30Hz 定时器单飞派发，避免 IPC 风暴
    private readonly System.Windows.Forms.Timer _moveTimer = new() { Interval = 33 };
    private POINT _pendingMove;
    private bool _movePending, _jsBusy;

    [StructLayout(LayoutKind.Sequential)]
    private struct MSLLHOOKSTRUCT { public POINT Pt; public uint MouseData, Flags, Time; public IntPtr ExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X, Y; }

    // 在窗口子树里按类名找后代窗口（WebView2 输入窗口嵌得很深）
    private static IntPtr FindDescendantByClass(IntPtr root, string className)
    {
        IntPtr found = IntPtr.Zero;
        EnumChildWindows(root, (c, _) =>
        {
            if (GetClassName(c) == className) { found = c; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    private IntPtr MouseHookProc(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0 && !_suspended && !_sessionLocked && _web is not null)
        {
            var msg = wParam.ToInt64();
            var info = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT))!;
            var over = WindowFromPoint(info.Pt);
            // 只在光标位于桌面（图标层/壁纸层/我们自己）时转发，应用窗口操作不受影响
            var root = over != IntPtr.Zero ? GetAncestor(over, GA_ROOT) : IntPtr.Zero;
            var rootClass = GetClassName(root);
            var onDesktop = rootClass is "Progman" or "WorkerW" || root == Handle || over == Handle;
            if (onDesktop)
            {
                if (msg == WM_MOUSEMOVE)
                {
                    // 移动走 JS 派发（Chromium 不为注入的 WM_MOUSEMOVE 合成 pointer 事件）
                    _pendingMove = info.Pt;
                    _movePending = true;
                }
                else
                {
                    if (_chromeInputHwnd == IntPtr.Zero || !IsWindow(_chromeInputHwnd))
                        _chromeInputHwnd = FindDescendantByClass(Handle, "Chrome_RenderWidgetHostHWND");
                    if (_chromeInputHwnd != IntPtr.Zero)
                    {
                        ScreenToClient(_chromeInputHwnd, ref info.Pt);
                        var lp = (IntPtr)((info.Pt.Y & 0xFFFF) << 16 | (info.Pt.X & 0xFFFF));
                        IntPtr wp;
                        switch (msg)
                        {
                            case WM_LBUTTONDOWN: _leftDown = true; wp = (IntPtr)1; break;
                            case WM_LBUTTONUP: _leftDown = false; wp = IntPtr.Zero; break;
                            case WM_RBUTTONDOWN: _rightDown = true; wp = (IntPtr)2; break;
                            case WM_RBUTTONUP: _rightDown = false; wp = IntPtr.Zero; break;
                            default: wp = IntPtr.Zero; break;
                        }
                        PostMessageW(_chromeInputHwnd, (uint)msg, wp, lp);
                    }
                }
            }
        }
        return CallNextHookEx(_mouseHook, code, wParam, lParam);
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookExW(int idHook, LowLevelMouseProc lpfn, IntPtr hMod, uint dwThreadId);

    private delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern IntPtr WindowFromPoint(POINT pt);

    [DllImport("user32.dll")]
    private static extern bool ScreenToClient(IntPtr hWnd, ref POINT pt);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool PostMessageW(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _moveTimer.Stop();
        if (_mouseHook != IntPtr.Zero) UnhookWindowsHookEx(_mouseHook);
        base.OnFormClosed(e);
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        if (!_windowed)
            BeginInvoke(EmbedIntoDesktop); // 延迟到 Show() 完全结束后再嵌入
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= 0x80; // WS_EX_TOOLWINDOW，不进 Alt+Tab
            return cp;
        }
    }

    protected override void WndProc(ref Message m)
    {
        const int WM_WTSSESSION_CHANGE = 0x02B1;
        if (m.Msg == WM_WTSSESSION_CHANGE)
        {
            _sessionLocked = m.WParam.ToInt64() == 0x7; // WTS_SESSION_LOCK
            ApplyPowerState();
        }
        base.WndProc(ref m);
    }

    // 把窗口挂到桌面图标的父窗口（Progman 或图标 WorkerW），垫在图标后面
    private void EmbedIntoDesktop()
    {
        // 发 0x052C 让 Progman 生成壁纸 WorkerW（若结构已是 Progman→DefView 也无害）
        _ = SendMessageTimeout(FindProgman(), 0x052C, IntPtr.Zero, IntPtr.Zero,
            SendMessageTimeoutFlags.SMTO_NORMAL, 1000, out _);

        var defView = FindDefView();
        if (defView == IntPtr.Zero)
        {
            DeskworldsWallpaper.Program.Log(WallpaperForm.LogPath(), "未找到 SHELLDLL_DefView，未嵌入");
            return;
        }
        var parent = GetParent(defView);
        if (parent == IntPtr.Zero) parent = FindProgman();
        if (parent == IntPtr.Zero)
        {
            DeskworldsWallpaper.Program.Log(WallpaperForm.LogPath(), "DefView 无父窗口，未嵌入");
            return;
        }

        // 改 WS_CHILD 子窗口样式后 SetParent，再放到图标层之下
        const int GWL_STYLE = -16, GWL_EXSTYLE = -20;
        const long WS_CHILD = 0x40000000, WS_VISIBLE = 0x10000000, WS_POPUP = 0x80000000, WS_EX_TOOLWINDOW = 0x80;
        SetWindowLongPtr(Handle, GWL_STYLE, (IntPtr)((GetWindowLongPtr(Handle, GWL_STYLE).ToInt64() & ~WS_POPUP) | WS_CHILD | WS_VISIBLE));
        SetWindowLongPtr(Handle, GWL_EXSTYLE, (IntPtr)(GetWindowLongPtr(Handle, GWL_EXSTYLE).ToInt64() & ~WS_EX_TOOLWINDOW));
        var ok = SetParent(Handle, parent);

        // 找到绘制静态壁纸的 WorkerW（Progman 子窗口）：要插到它之上、图标之下，
        // 直接 HWND_BOTTOM 会被它画的壁纸盖住
        var wallpaperWorker = IntPtr.Zero;
        EnumChildWindows(parent, (c, _) =>
        {
            if (GetClassName(c) == "WorkerW" && c != Handle) { wallpaperWorker = c; return false; }
            return true;
        }, IntPtr.Zero);
        var swp = SetWindowPos(Handle, HWND_BOTTOM, 0, 0, Bounds.Width, Bounds.Height,
            SWP_FRAMECHANGED | SWP_SHOWWINDOW | SWP_NOACTIVATE);
        // hWndInsertAfter 语义是“放到它之下”，所以反向把壁纸 WorkerW 压到我们窗口之下
        if (wallpaperWorker != IntPtr.Zero)
            SetWindowPos(wallpaperWorker, Handle, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        ShowWindow(Handle, SW_SHOW);
        GetWindowRect(Handle, out var r);
        DeskworldsWallpaper.Program.Log(WallpaperForm.LogPath(),
            $"嵌入：defView=0x{defView.ToInt64():X} parent=0x{parent.ToInt64():X}({GetClassName(parent)}) workerw=0x{wallpaperWorker.ToInt64():X} setParent={ok} setWindowPos={swp} visible={IsWindowVisible(Handle)} rect={r.Left},{r.Top},{r.Right},{r.Bottom}");
    }

    // 用枚举按类名找 Progman（FindWindow 在部分 Win11 上找不到它）
    private static IntPtr FindProgman()
    {
        var p = FindWindow("Progman", null);
        if (p != IntPtr.Zero) return p;
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, _) =>
        {
            if (GetClassName(h) == "Progman") { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    // 找 SHELLDLL_DefView（图标列表）：先在 Progman 下找，再遍历顶层窗口找
    private static IntPtr FindDefView()
    {
        var progman = FindProgman();
        if (progman != IntPtr.Zero)
        {
            var d = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (d != IntPtr.Zero) return d;
        }
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, _) =>
        {
            var d = FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (d != IntPtr.Zero) { found = d; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    internal static string LogPath() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeskworldsWallpaper", "crash.log");
    private async Task InitWebViewAsync(string url)
    {
        _web = new WebView2 { Bounds = Bounds, DefaultBackgroundColor = Color.Black };
        Controls.Add(_web);
        var env = await CoreWebView2Environment.CreateAsync(userDataFolder:
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeskworldsWallpaper"));
        await _web.EnsureCoreWebView2Async(env);
        _web.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
        _web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        _web.CoreWebView2.Settings.IsZoomControlEnabled = false;
        _web.CoreWebView2.Settings.IsStatusBarEnabled = false;
        _web.CoreWebView2.NavigationCompleted += async (_, e) =>
        {
            if (!e.IsSuccess)
                DeskworldsWallpaper.Program.Log(WallpaperForm.LogPath(), $"导航失败：{e.WebErrorStatus}");
            // 壁纸模式：隐藏页面自带的场景导航/控制条（页面 H 键同款 clean 模式）
            await _web.CoreWebView2.ExecuteScriptAsync(
                "document.body.classList.add('clean');document.querySelectorAll('.chrome').forEach(el=>el.inert=true);");
        };
        _web.CoreWebView2.Navigate(url);
        _web.BringToFront();
    }

    private void InitTray()
    {
        var menu = new ContextMenuStrip();
        foreach (var (name, path) in Worlds)
        {
            var p = path;
            menu.Items.Add(name, null, (_, _) =>
            {
                _userPaused = false;
                _web?.CoreWebView2?.Navigate(_server!.Url + p);
            });
        }
        menu.Items.Add(new ToolStripSeparator());
        _pauseItem = new ToolStripMenuItem("暂停", null, (_, _) =>
        {
            _userPaused = !_userPaused;
            ApplyPowerState();
        });
        menu.Items.Add(_pauseItem);
        menu.Items.Add("退出", null, (_, _) =>
        {
            _tray!.Visible = false;
            Close();
        });

        _tray = new NotifyIcon
        {
            Text = "Deskworlds 壁纸",
            ContextMenuStrip = menu,
            Visible = true,
            Icon = SystemIcons.Application,
        };
    }

    // 省电策略：全屏应用运行 / 锁屏 / 电池供电 / 手动暂停 → 挂起 WebView 渲染
    private void ApplyPowerState()
    {
        var shouldSuspend = _userPaused || _sessionLocked
            || QueryFullscreenState()
            || (SuspendOnBattery && SystemInformation.PowerStatus.PowerLineStatus == PowerLineStatus.Offline);
        if (shouldSuspend == _suspended) return;

        var core = _web?.CoreWebView2;
        if (core is null) return;
        _suspended = shouldSuspend;
        _pauseItem!.Text = _userPaused ? "恢复" : "暂停";
        if (_suspended) _ = core.TrySuspendAsync();
        else core.Resume();
    }

    private static bool QueryFullscreenState()
    {
        SHQueryUserNotificationState(out var state);
        return state is QUERY_USER_NOTIFICATION_STATE.QUNS_BUSY
            or QUERY_USER_NOTIFICATION_STATE.QUNS_RUNNING_D3D_FULL_SCREEN
            or QUERY_USER_NOTIFICATION_STATE.QUNS_PRESENTATION_MODE;
    }

    private static string? GetClassName(IntPtr h)
    {
        var sb = new StringBuilder(256);
        return GetClassName(h, sb, sb.Capacity) > 0 ? sb.ToString() : null;
    }

    // 从 exe 目录向上找包含 index.html 的仓库根目录
    private static string? FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "index.html"))) return dir.FullName;
            dir = dir.Parent!;
        }
        return null;
    }

    private enum QUERY_USER_NOTIFICATION_STATE
    {
        QUNS_NOT_PRESENT = 1, QUNS_BUSY = 2, QUNS_RUNNING_D3D_FULL_SCREEN = 3,
        QUNS_PRESENTATION_MODE = 4, QUNS_ACCEPTS_NOTIFICATIONS = 5, QUNS_QUIET_TIME = 6, QUNS_APP = 7,
    }

    [DllImport("shell32.dll")]
    private static extern int SHQueryUserNotificationState(out QUERY_USER_NOTIFICATION_STATE state);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string windowName);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

    [DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);

    private const uint GA_ROOT = 2;

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam,
        SendMessageTimeoutFlags flags, uint timeout, out IntPtr result);

    [Flags]
    private enum SendMessageTimeoutFlags : uint { SMTO_NORMAL = 0x0 }

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSRegisterSessionNotification(IntPtr hWnd, int flags);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);

    private const uint SWP_FRAMECHANGED = 0x20, SWP_SHOWWINDOW = 0x40,
        SWP_NOMOVE = 0x2, SWP_NOSIZE = 0x1, SWP_NOACTIVATE = 0x10;
    private static readonly IntPtr HWND_BOTTOM = new(1);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    private const int SW_SHOW = 5;
}