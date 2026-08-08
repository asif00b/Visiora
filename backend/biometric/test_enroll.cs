using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct FTR_DATA {
    public int dwSize;
    public IntPtr pData;
}

public class Program {
    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRInitialize();
    
    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern void FTRTerminate();
    
    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTREnroll(IntPtr usrContext, int purpose, ref FTR_DATA pTemplate);
    
    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRGetParam(int paramCode, ref int pParamValue);
    
    static int Main() {
        int res = FTRInitialize();
        if (res != 0) {
            Console.WriteLine("FTRInitialize failed: " + res);
            return 1;
        }
        
        int maxSize = 0;
        FTRGetParam(6, ref maxSize); // FTR_PARAM_MAX_TEMPLATE_SIZE = 6
        Console.WriteLine("Max Template Size: " + maxSize);
        
        FTR_DATA template = new FTR_DATA();
        template.dwSize = maxSize;
        template.pData = Marshal.AllocHGlobal(maxSize);
        
        Console.WriteLine("Calling FTREnroll (Please touch sensor)...");
        int enrollRes = FTREnroll(IntPtr.Zero, 1, ref template);
        Console.WriteLine("FTREnroll returned: " + enrollRes);
        
        Marshal.FreeHGlobal(template.pData);
        FTRTerminate();
        return 0;
    }
}
