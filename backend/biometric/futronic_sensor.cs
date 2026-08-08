using System;
using System.IO;
using System.Runtime.InteropServices;

public class Program {
    [DllImport("ftrScanAPI.dll")]
    public static extern IntPtr ftrScanOpenDevice();

    [DllImport("ftrScanAPI.dll")]
    public static extern void ftrScanCloseDevice(IntPtr h);

    [DllImport("ftrScanAPI.dll")]
    public static extern bool ftrScanGetFrame(IntPtr h, int dose, byte[] buf);

    [DllImport("ftrScanAPI.dll")]
    public static extern bool ftrScanIsFingerPresent(IntPtr h, out int present);

    static int Main(string[] args) {
        if (args.Length == 0) { Console.Write("USAGE"); return 1; }

        IntPtr h;
        try { h = ftrScanOpenDevice(); }
        catch { Console.Write("DEVICE_ERROR"); return 2; }

        if (h == IntPtr.Zero) { Console.Write("DEVICE_OFFLINE"); return 2; }

        if (args[0] == "poll") {
            int p = 0;
            ftrScanIsFingerPresent(h, out p);
            ftrScanCloseDevice(h);
            Console.Write(p == 1 ? "FINGER_ON" : "FINGER_OFF");
            return 0;
        }

        if (args[0] == "capture") {
            string outFile = args.Length > 1 ? args[1] : "scan_output.bin";
            byte[] buf = new byte[153600];
            ftrScanGetFrame(h, 0, buf);
            ftrScanCloseDevice(h);
            File.WriteAllBytes(outFile, buf);
            Console.Write("CAPTURE_OK");
            return 0;
        }

        ftrScanCloseDevice(h);
        Console.Write("UNKNOWN");
        return 1;
    }
}
