// FreeFlow PasteHelper - tiny console tool that simulates the paste shortcut
// (Ctrl+V, or Shift+Insert with --shift-insert) with SendInput, after releasing
// any modifier key the user may still be holding (mirrors Wispr Flow's
// "WindowsKeyUpSimulation" + PasteText/PasteOutcome flow).
//
//   PasteHelper.exe [--dry-run] [--shift-insert] [--delay <ms>] [--no-release] [--info] [--only-if <process>]
//   (--only-if: send nothing unless that process owns the foreground window, checked right before sending)
//   PasteHelper.exe --read-focused   (text of the focused field through UI Automation, to notice
//                                     the corrections made right after a paste; password fields
//                                     are never read)
//   PasteHelper.exe --mask   (taps the unassigned key vkE8 so releasing a held Win key
//                             does not open the Start menu - Wispr's "WindowsShortcutMaskingV2")
//
// Exit codes: 0 pasted (or dry-run), 2 blocked (SendInput rejected events, e.g.
// UIPI against an elevated window), 3 unexpected error.
// Build: npm run build:native (csc.exe of .NET Framework 4 + the WPF UI Automation assemblies)
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

static class PasteHelper
{
    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    // The union must be as large as MOUSEINPUT (32 bytes on x64) so that INPUT is 40
    // bytes: with a smaller struct SendInput rejects every event (ERROR_INVALID_PARAMETER)
    // and nothing was ever pasted (FreeFlow 1.0 reported "blocked" every time).
    [StructLayout(LayoutKind.Explicit)]
    struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public long pad1; [FieldOffset(8)] public long pad2; [FieldOffset(16)] public long pad3; [FieldOffset(24)] public long pad4; }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public INPUTUNION u; }

    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_SCANCODE = 0x0008;

    const ushort VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12;
    const ushort VK_LSHIFT = 0xA0, VK_RSHIFT = 0xA1, VK_LCONTROL = 0xA2, VK_RCONTROL = 0xA3;
    const ushort VK_LMENU = 0xA4, VK_RMENU = 0xA5, VK_LWIN = 0x5B, VK_RWIN = 0x5C;
    const ushort VK_INSERT = 0x2D, VK_V = 0x56, VK_SPACE = 0x20;

    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);

    static bool dryRun;
    static StringBuilder plan = new StringBuilder();

    static INPUT Key(ushort vk, bool up)
    {
        var i = new INPUT { type = INPUT_KEYBOARD };
        i.u.ki.wVk = vk;
        i.u.ki.wScan = (ushort)MapVirtualKey(vk, 0);
        i.u.ki.dwFlags = up ? KEYEVENTF_KEYUP : 0;
        if (vk == VK_INSERT || vk == VK_RCONTROL || vk == VK_RMENU || vk == VK_LWIN || vk == VK_RWIN)
            i.u.ki.dwFlags |= KEYEVENTF_EXTENDEDKEY;
        return i;
    }

    static string Name(ushort vk)
    {
        switch (vk)
        {
            case VK_LSHIFT: return "LShift"; case VK_RSHIFT: return "RShift";
            case VK_LCONTROL: return "LCtrl"; case VK_RCONTROL: return "RCtrl";
            case VK_LMENU: return "LAlt"; case VK_RMENU: return "RAlt";
            case VK_LWIN: return "LWin"; case VK_RWIN: return "RWin";
            case VK_SHIFT: return "Shift"; case VK_CONTROL: return "Ctrl"; case VK_MENU: return "Alt";
            case VK_INSERT: return "Insert"; case VK_V: return "V"; case VK_SPACE: return "Space";
            default: return "VK" + vk;
        }
    }

    // Returns the number of events the OS accepted (or the requested count in dry-run).
    static uint Send(INPUT[] seq, string label)
    {
        var sb = new StringBuilder(label + ":");
        foreach (var e in seq) sb.Append(' ').Append(Name(e.u.ki.wVk)).Append((e.u.ki.dwFlags & KEYEVENTF_KEYUP) != 0 ? "^" : "v");
        plan.Append(sb).Append(" | ");
        if (dryRun) return (uint)seq.Length;
        return SendInput((uint)seq.Length, seq, Marshal.SizeOf(typeof(INPUT)));
    }

    static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);   // window titles and field text keep their accents
        bool shiftInsert = false, release = true, info = false, mask = false, readFocused = false;
        int delay = 0;
        string onlyIf = null;
        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--dry-run": dryRun = true; break;
                case "--shift-insert": shiftInsert = true; break;
                case "--no-release": release = false; break;
                case "--info": info = true; break;
                case "--mask": mask = true; break;
                case "--delay": if (i + 1 < args.Length) int.TryParse(args[++i], out delay); break;
                case "--only-if": if (i + 1 < args.Length) onlyIf = args[++i]; break;
                case "--read-focused": readFocused = true; break;
                case "-h": case "--help":
                    Console.WriteLine("PasteHelper [--dry-run] [--shift-insert] [--delay ms] [--no-release] [--info] [--only-if process] [--mask]");
                    return 0;
            }
        }
        try
        {
            string fgProc = "", fgTitle = "", fgClass = "";
            IntPtr hwnd = GetForegroundWindow();
            if (hwnd != IntPtr.Zero)
            {
                uint pid; GetWindowThreadProcessId(hwnd, out pid);
                try { fgProc = Process.GetProcessById((int)pid).ProcessName; } catch { }
                var t = new StringBuilder(256); GetWindowText(hwnd, t, 256); fgTitle = t.ToString();
                var c = new StringBuilder(128); GetClassName(hwnd, c, 128); fgClass = c.ToString();
            }
            if (mask)
            {
                const ushort VK_MASK = 0xE8; // unassigned: apps ignore it, but Windows sees "Win + another key"
                uint ok = Send(new[] { Key(VK_MASK, false), Key(VK_MASK, true) }, "mask");
                Console.WriteLine("{\"outcome\":\"" + (dryRun ? "dry-run" : ok == 2 ? "masked" : "blocked") + "\",\"plan\":\"" + Esc(plan.ToString().TrimEnd(' ', '|')) + "\"}");
                return 0;
            }
            if (info)
            {
                Console.WriteLine("{\"outcome\":\"info\",\"process\":\"" + Esc(fgProc) + "\",\"title\":\"" + Esc(fgTitle) + "\",\"class\":\"" + Esc(fgClass) + "\"}");
                return 0;
            }
            if (readFocused)
            {
                string kind = "none", text = null;
                try
                {
                    AutomationElement el = AutomationElement.FocusedElement;
                    if (el != null)
                    {
                        object pattern;
                        if ((bool)el.GetCurrentPropertyValue(AutomationElement.IsPasswordProperty)) kind = "password";
                        else if (el.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) { text = ((TextPattern)pattern).DocumentRange.GetText(-1); kind = "text"; }
                        else if (el.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) { text = ((ValuePattern)pattern).Current.Value; kind = "value"; }
                    }
                }
                catch (Exception) { kind = "error"; }
                if (text != null && text.Length > 50000) text = text.Substring(0, 50000);
                Console.WriteLine("{\"outcome\":\"focused\",\"kind\":\"" + kind + "\",\"process\":\"" + Esc(fgProc) + "\",\"text\":" + (text == null ? "null" : "\"" + Json(text) + "\"") + "}");
                return 0;
            }

            if (delay > 0) { plan.Append("sleep " + delay + "ms | "); if (!dryRun) Thread.Sleep(delay); }

            if (onlyIf != null)
            {
                string now = "";
                IntPtr fg = GetForegroundWindow();
                uint fpid; GetWindowThreadProcessId(fg, out fpid);
                try { now = Process.GetProcessById((int)fpid).ProcessName; } catch { }
                if (!string.Equals(now, onlyIf, StringComparison.OrdinalIgnoreCase))
                {
                    Console.WriteLine("{\"outcome\":\"skipped\",\"process\":\"" + Esc(now) + "\"}");
                    return 4;
                }
            }

            uint sent = 0, wanted = 0;
            if (release)
            {
                // Release whatever the user still holds from the trigger shortcut
                // (e.g. Ctrl+Alt+Space) so the paste chord is not polluted.
                ushort[] mods = { VK_LSHIFT, VK_RSHIFT, VK_LCONTROL, VK_RCONTROL, VK_LMENU, VK_RMENU, VK_LWIN, VK_RWIN, VK_SPACE };
                var ups = new System.Collections.Generic.List<INPUT>();
                foreach (var vk in mods)
                    if ((GetAsyncKeyState(vk) & 0x8000) != 0) ups.Add(Key(vk, true));
                if (ups.Count > 0) { wanted += (uint)ups.Count; sent += Send(ups.ToArray(), "release"); if (!dryRun) Thread.Sleep(30); }
                else plan.Append("release: nothing held | ");
            }

            INPUT[] chord = shiftInsert
                ? new[] { Key(VK_LSHIFT, false), Key(VK_INSERT, false), Key(VK_INSERT, true), Key(VK_LSHIFT, true) }
                : new[] { Key(VK_LCONTROL, false), Key(VK_V, false), Key(VK_V, true), Key(VK_LCONTROL, true) };
            wanted += (uint)chord.Length;
            sent += Send(chord, shiftInsert ? "paste(Shift+Insert)" : "paste(Ctrl+V)");

            string outcome = dryRun ? "dry-run" : (sent == wanted ? "pasted" : "blocked");
            Console.WriteLine("{\"outcome\":\"" + outcome + "\",\"sent\":" + sent + ",\"wanted\":" + wanted +
                              ",\"process\":\"" + Esc(fgProc) + "\",\"title\":\"" + Esc(fgTitle) + "\",\"plan\":\"" + Esc(plan.ToString().TrimEnd(' ', '|')) + "\"}");
            return outcome == "blocked" ? 2 : 0;
        }
        catch (Exception ex)
        {
            Console.WriteLine("{\"outcome\":\"failed\",\"error\":\"" + Esc(ex.Message) + "\"}");
            return 3;
        }
    }

    static string Esc(string s) { return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", " ").Replace("\r", ""); }

    // Full JSON string escaping (keeps line breaks of the field text).
    static string Json(string s)
    {
        var sb = new StringBuilder(s.Length + 16);
        foreach (char c in s)
        {
            switch (c)
            {
                case '\\': sb.Append("\\\\"); break;
                case '"': sb.Append("\\\""); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4")); else sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }
}
