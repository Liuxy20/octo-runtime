// Test-only bridge: a hidden, isolated console permits real Ctrl+C delivery.
// It never broadcasts to the developer's or test runner's console.
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

class WindowsConsoleControl
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct StartupInfo
    {
        public int cb;
        public string reserved, desktop, title;
        public int x, y, width, height, charsX, charsY, fill, flags;
        public short show, reservedBytes;
        public IntPtr reservedPointer, stdin, stdout, stderr;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo
    {
        public IntPtr process, thread;
        public uint pid, tid;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes,
        IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory,
        ref StartupInfo startup, out ProcessInfo process);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int handle);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
    [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AttachConsole(uint pid);
    [DllImport("kernel32.dll")] static extern bool FreeConsole();
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GenerateConsoleCtrlEvent(uint signal, uint group);

    static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char item in value)
        {
            if (item == '\\') { slashes++; continue; }
            result.Append('\\', item == '"' ? slashes * 2 + 1 : slashes);
            result.Append(item);
            slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }

    static int Main(string[] args)
    {
        try
        {
            if (args[0] == "interrupt")
            {
                FreeConsole();
                if (!AttachConsole(uint.Parse(args[1]))) throw new Win32Exception();
                try
                {
                    if (!SetConsoleCtrlHandler(IntPtr.Zero, true)) throw new Win32Exception();
                    if (!GenerateConsoleCtrlEvent(0, 0)) throw new Win32Exception();
                }
                finally { FreeConsole(); }
                return 0;
            }
            var command = new StringBuilder();
            for (int index = 1; index < args.Length; index++)
            {
                if (index > 1) command.Append(' ');
                command.Append(Quote(args[index]));
            }
            var startup = new StartupInfo();
            startup.cb = Marshal.SizeOf(startup);
            startup.flags = 0x101; // STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW
            startup.show = 0; // SW_HIDE
            startup.stdin = GetStdHandle(-10);
            startup.stdout = GetStdHandle(-11);
            startup.stderr = GetStdHandle(-12);
            ProcessInfo child;
            if (!CreateProcess(args[1], command, IntPtr.Zero, IntPtr.Zero, true,
                0x10, IntPtr.Zero, Environment.CurrentDirectory, ref startup, out child))
                throw new Win32Exception(); // CREATE_NEW_CONSOLE
            CloseHandle(child.thread);
            try
            {
                Console.Error.WriteLine("TEST_CONSOLE_PID=" + child.pid);
                // Parent test has its own deadline and owns fixture cleanup.
                WaitForSingleObject(child.process, 0xffffffff);
                uint code;
                if (!GetExitCodeProcess(child.process, out code)) throw new Win32Exception();
                return unchecked((int)code);
            }
            finally { CloseHandle(child.process); }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
            return 1;
        }
    }
}
