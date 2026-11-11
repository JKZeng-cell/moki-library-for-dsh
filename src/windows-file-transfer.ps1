$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = [Console]::InputEncoding
Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

[ComVisible(true), Guid("00000121-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMokiDropSource {
    [PreserveSig] int QueryContinueDrag([MarshalAs(UnmanagedType.Bool)] bool escape, int keys);
    [PreserveSig] int GiveFeedback(int effect);
}

[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public class MokiFileDrag : IMokiDropSource {
    struct Point { public int x,y; }
    [StructLayout(LayoutKind.Sequential)]
    struct GuiThread {
        public uint size,flags;
        public IntPtr active,focus,capture,menu,move,caret;
        public int left,top,right,bottom;
    }
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint id,ref GuiThread info);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr hwnd,ref Point point);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd,uint msg,IntPtr wp,IntPtr lp);
    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int key);
    [DllImport("ole32.dll")] static extern int OleInitialize(IntPtr reserved);
    [DllImport("ole32.dll")] static extern void OleUninitialize();
    [DllImport("ole32.dll", ExactSpelling=true)]
    static extern int DoDragDrop([MarshalAs(UnmanagedType.Interface)] IDataObject files, IMokiDropSource source, int allowed, out int effect);
    public int QueryContinueDrag(bool escape, int keys) {
        if (escape || GetAsyncKeyState(27)<0) return 0x40101;
        return GetAsyncKeyState(1) < 0 ? 0 : 0x40100;
    }
    public int GiveFeedback(int effect) { return 0x40102; }
    public static string Start(System.Windows.Forms.DataObject files) {
        if (GetAsyncKeyState(1) >= 0) return "None";
        Marshal.ThrowExceptionForHR(OleInitialize(IntPtr.Zero));
        try {
            int effect;
            uint thread=GetCurrentThreadId();
            // The gesture began in DSH's renderer. Wake this helper's OLE
            // capture window with the physical pointer position and release.
            // Coordinates in WM_MOUSEMOVE are relative to that window.
            using (var timer=new System.Threading.Timer(delegate(object unused) {
                var info=new GuiThread();info.size=(uint)Marshal.SizeOf(info);
                Point point;
                if (!GetGUIThreadInfo(thread,ref info) || info.capture==IntPtr.Zero ||
                    !GetCursorPos(out point) || !ScreenToClient(info.capture,ref point)) return;
                bool down=GetAsyncKeyState(1)<0;
                int position=(point.x & 65535) | (point.y << 16);
                PostMessage(info.capture,down ? 0x200u : 0x202u,(IntPtr)(down?1:0),(IntPtr)position);
            },null,16,24)) {
                int status = DoDragDrop((IDataObject)files, new MokiFileDrag(), 1, out effect);
                Marshal.ThrowExceptionForHR(status);
                return effect == 1 ? "Copy" : "None";
            }
        } finally { OleUninitialize(); }
    }
}
'@
[Console]::WriteLine('ready')
while ($null -ne ($line = [Console]::ReadLine())) {
        try {
            $request = ConvertFrom-Json -InputObject $line
            $files = New-Object Collections.Specialized.StringCollection
            foreach ($file in $request.paths) { [void]$files.Add([string]$file) }
            $data = New-Object Windows.Forms.DataObject
            $data.SetFileDropList($files)
            if ($request.action -eq 'copy') {
                [Windows.Forms.Clipboard]::SetDataObject($data, $true, 10, 50)
                $result = 'copied'
            } else {
                $result = [MokiFileDrag]::Start($data)
            }
            $response = @{ id = $request.id; result = $result }
        } catch {
            $response = @{ id = $request.id; error = $_.Exception.Message }
        }
        [Console]::WriteLine((ConvertTo-Json -Compress -InputObject $response))
}
