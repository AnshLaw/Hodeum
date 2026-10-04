# Dot-source this first: . .\HodeumNative.ps1
# Makes the PowerShell process Per-Monitor-V2 DPI aware (must run before any window/screen API),
# then exposes physical-pixel helpers used by every other harness script.
# The C# is compiled once to HodeumNative.dll next to this file (Add-Type costs ~4 s per process otherwise).
$hodeumDll = Join-Path $PSScriptRoot 'HodeumNative.dll'
if (-not ('HodeumNative' -as [type])) {
$hodeumSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class HodeumNative {
    // ---- DPI ----
    static readonly IntPtr PER_MONITOR_AWARE_V2 = new IntPtr(-4);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
    [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int value);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
    public static string MakeDpiAware() {
        if (SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)) return "process PMv2";
        // Already set for this process (e.g. host manifest): force it per thread instead.
        if (SetThreadDpiAwarenessContext(PER_MONITOR_AWARE_V2) != IntPtr.Zero) return "thread PMv2";
        return SetProcessDpiAwareness(2) == 0 ? "process PM(v1)" : "UNAWARE";
    }

    // ---- virtual screen ----
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
    public static int[] VirtualScreen() {
        return new int[] { GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79) };
    }

    // ---- monitors ----
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct MONITORINFOEX { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice; }
    delegate bool MonitorEnumProc(IntPtr h, IntPtr hdc, ref RECT r, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr h, ref MONITORINFOEX mi);
    [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr h, int type, out uint x, out uint y);
    public static List<string> Monitors() {
        var list = new List<string>();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr h, IntPtr hdc, ref RECT r, IntPtr d) => {
            var mi = new MONITORINFOEX(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
            GetMonitorInfo(h, ref mi); uint dx, dy; GetDpiForMonitor(h, 0, out dx, out dy);
            list.Add(String.Format("{0} x={1} y={2} w={3} h={4} dpi={5} scale={6} primary={7}", mi.szDevice,
                mi.rcMonitor.Left, mi.rcMonitor.Top, mi.rcMonitor.Right - mi.rcMonitor.Left,
                mi.rcMonitor.Bottom - mi.rcMonitor.Top, dx, dx / 96.0, (mi.dwFlags & 1) == 1));
            return true; }, IntPtr.Zero);
        return list;
    }

    // ---- windows ----
    delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
    public class Win { public long Hwnd; public uint Pid; public string Title, Class; public bool Visible;
        public int X, Y, W, H; public string ExStyle; public uint Dpi; }
    public static List<Win> Windows(uint pidFilter) {
        var list = new List<Win>();
        EnumWindows((h, l) => {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (pidFilter != 0 && pid != pidFilter) return true;
            var t = new StringBuilder(256); GetWindowText(h, t, 256);
            var c = new StringBuilder(256); GetClassName(h, c, 256);
            RECT r; if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out r);
            long ex = GetWindowLongPtr(h, -20).ToInt64();
            list.Add(new Win { Hwnd = h.ToInt64(), Pid = pid, Title = t.ToString(), Class = c.ToString(),
                Visible = IsWindowVisible(h), X = r.Left, Y = r.Top, W = r.Right - r.Left, H = r.Bottom - r.Top,
                ExStyle = "0x" + ex.ToString("X8"), Dpi = GetDpiForWindow(h) });
            return true; }, IntPtr.Zero);
        return list;
    }
    // WS_EX_TRANSPARENT 0x20, WS_EX_TOOLWINDOW 0x80, WS_EX_TOPMOST 0x8, WS_EX_LAYERED 0x80000, WS_EX_NOACTIVATE 0x8000000
    public static string DecodeEx(long ex) {
        var parts = new List<string>();
        if ((ex & 0x8) != 0) parts.Add("TOPMOST"); if ((ex & 0x20) != 0) parts.Add("TRANSPARENT(click-through)");
        if ((ex & 0x80) != 0) parts.Add("TOOLWINDOW"); if ((ex & 0x80000) != 0) parts.Add("LAYERED");
        if ((ex & 0x8000000) != 0) parts.Add("NOACTIVATE"); if ((ex & 0x200000) != 0) parts.Add("NOREDIRECTIONBITMAP");
        return String.Join("|", parts);
    }

    // ---- capture: BitBlt from the screen DC with CAPTUREBLT so layered windows are included ----
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
    [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);
    public static System.Drawing.Bitmap Capture(int x, int y, int w, int h) {
        var bmp = new System.Drawing.Bitmap(w, h, System.Drawing.Imaging.PixelFormat.Format32bppRgb);
        using (var g = System.Drawing.Graphics.FromImage(bmp)) {
            IntPtr dst = g.GetHdc(); IntPtr src = GetDC(IntPtr.Zero);
            try {
                if (!BitBlt(dst, 0, 0, w, h, src, x, y, 0x00CC0020 | 0x40000000))
                    throw new Exception("BitBlt failed, error " + Marshal.GetLastWin32Error());
            } finally { ReleaseDC(IntPtr.Zero, src); g.ReleaseHdc(dst); }
        }
        return bmp;
    }

    // ---- input (SendInput, absolute coords over the virtual desktop) ----
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    const uint MOVE = 0x1, LDOWN = 0x2, LUP = 0x4, RDOWN = 0x8, RUP = 0x10, ABS = 0x8000, VDESK = 0x4000;
    static INPUT Mouse(int x, int y, uint flags) {
        var v = VirtualScreen();
        // Normalise to 0..65535 across the virtual desktop (physical px because we are PMv2 aware).
        int nx = (int)Math.Round((x - v[0]) * 65535.0 / (v[2] - 1));
        int ny = (int)Math.Round((y - v[1]) * 65535.0 / (v[3] - 1));
        var i = new INPUT { type = 0 }; i.u.mi = new MOUSEINPUT { dx = nx, dy = ny, dwFlags = flags | ABS | VDESK }; return i;
    }
    static void Send(params INPUT[] inputs) {
        uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        if (sent != inputs.Length) throw new Exception("SendInput blocked (UIPI or secure desktop), error " + Marshal.GetLastWin32Error());
    }
    public static void MoveTo(int x, int y) { Send(Mouse(x, y, MOVE)); }
    public static void Click(int x, int y, bool right) {
        Send(Mouse(x, y, MOVE));
        System.Threading.Thread.Sleep(40);
        // A human-like press: some shells (Explorer's context menu) ignore a zero-length down/up pair.
        Send(Mouse(x, y, right ? RDOWN : LDOWN));
        System.Threading.Thread.Sleep(60);
        Send(Mouse(x, y, right ? RUP : LUP));
    }
    public static void Key(ushort vk, bool up) {
        var i = new INPUT { type = 1 }; i.u.ki = new KEYBDINPUT { wVk = vk, dwFlags = up ? 2u : 0u }; Send(i);
    }
    public static void Chord(params ushort[] vks) {
        foreach (var k in vks) Key(k, false);
        for (int j = vks.Length - 1; j >= 0; j--) Key(vks[j], true);
    }
    // KEYEVENTF_UNICODE: types any character into the focused control, independent of keyboard layout.
    public static void TypeText(string text) {
        foreach (char ch in text) {
            var d = new INPUT { type = 1 }; d.u.ki = new KEYBDINPUT { wScan = ch, dwFlags = 0x4 };
            var u = new INPUT { type = 1 }; u.u.ki = new KEYBDINPUT { wScan = ch, dwFlags = 0x4 | 0x2 };
            Send(d, u); System.Threading.Thread.Sleep(5);
        }
    }
}
'@
if (-not (Test-Path $hodeumDll) -or (Get-Item $hodeumDll).LastWriteTime -lt (Get-Item $PSCommandPath).LastWriteTime) {
    Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition $hodeumSource -OutputAssembly $hodeumDll -OutputType Library
}
Add-Type -Path $hodeumDll
}
$script:HodeumDpiMode = [HodeumNative]::MakeDpiAware()
