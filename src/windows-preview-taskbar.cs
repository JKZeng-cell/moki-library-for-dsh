using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class MokiPreviewTaskbar
{
    const string AppId = "MOKI.Library.DSH.Preview";
    static readonly Guid AppModel = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");

    [StructLayout(LayoutKind.Sequential)]
    struct PropertyKey { public Guid format; public uint id; }
    [StructLayout(LayoutKind.Sequential)]
    struct PropertyValue {
        public ushort type, reserved1, reserved2, reserved3;
        public IntPtr text, padding;
    }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore {
        void GetCount(out uint count);
        void GetAt(uint index, out PropertyKey key);
        void GetValue(ref PropertyKey key, out PropertyValue value);
        void SetValue(ref PropertyKey key, ref PropertyValue value);
        void Commit();
    }
    delegate bool VisitWindow(IntPtr hwnd, IntPtr unused);
    [DllImport("user32.dll")] static extern bool EnumWindows(VisitWindow visit, IntPtr unused);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int capacity);
    [DllImport("shell32.dll", PreserveSig = false)]
    static extern void SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropertyValue value);

    static void SetText(IPropertyStore store, PropertyKey key, string text) {
        var value = new PropertyValue { type = 31, text = Marshal.StringToCoTaskMemUni(text) }; // VT_LPWSTR
        try { store.SetValue(ref key, ref value); }
        finally { PropVariantClear(ref value); }
    }

    static void Bind(IntPtr hwnd, string resource) {
        var iid = typeof(IPropertyStore).GUID;
        IPropertyStore store;
        SHGetPropertyStoreForWindow(hwnd, ref iid, out store);
        try {
            var identity = new PropertyKey { format = AppModel, id = 5 };
            PropertyValue current;
            store.GetValue(ref identity, out current);
            try { if (current.type == 31 && Marshal.PtrToStringUni(current.text) == AppId) return; }
            finally { PropVariantClear(ref current); }
            // Explorer reads the group icon when the identity is assigned.
            SetText(store, new PropertyKey { format = AppModel, id = 3 }, resource);
            SetText(store, identity, AppId);
        } finally { Marshal.ReleaseComObject(store); }
    }

    static int BindWindows(int pid, string resource) {
        int count = 0;
        EnumWindows(delegate(IntPtr hwnd, IntPtr unused) {
            uint owner;
            GetWindowThreadProcessId(hwnd, out owner);
            if (owner != pid || !IsWindowVisible(hwnd) || GetWindow(hwnd, 4) != IntPtr.Zero) return true; // GW_OWNER
            var name = new StringBuilder(80);
            GetClassName(hwnd, name, name.Capacity);
            if (name.ToString() != "Chrome_WidgetWin_1") return true;
            try { Bind(hwnd, resource); count++; }
            catch (COMException) { } // The window may close while it is being enumerated.
            return true;
        }, IntPtr.Zero);
        return count;
    }

    public static void Run(int pid, string iconPath) {
        Process browser;
        try { browser = Process.GetProcessById(pid); }
        catch (ArgumentException) { return; }
        using (browser) {
            if (browser.Handle == IntPtr.Zero) return; // Keep the original process object across notifications.
            string line;
            while ((line = Console.ReadLine()) != null) {
                int expected;
                if (!Int32.TryParse(line, out expected) || expected < 1) continue;
                // A page target can exist a little before its native window becomes visible.
                for (int attempt = 0; attempt < 12 && !browser.HasExited; attempt++) {
                    if (BindWindows(pid, iconPath + ",0") >= expected) break;
                    if (browser.WaitForExit(100)) return;
                }
            }
        }
    }
}
