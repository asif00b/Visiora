using System;
using System.Runtime.InteropServices;

public class TestCB {
    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRInitialize();
    
    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern void FTRTerminate();
    
    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRSetParam(int paramCode, FTR_STATE_CB paramValue);
    
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    public delegate void FTR_STATE_CB(int stateMask, int response, int signal, int bitmapSize, IntPtr bitmapData);
    
    static void CB(int stateMask, int response, int signal, int bitmapSize, IntPtr bitmapData) {}
    static FTR_STATE_CB _cb = new FTR_STATE_CB(CB);
    
    static int Main() {
        FTRInitialize();
        for (int i = 1; i <= 20; i++) {
            int res = FTRSetParam(i, _cb);
            if (res == 0) {
                Console.WriteLine("SUCCESS paramCode: " + i);
            }
        }
        FTRTerminate();
        return 0;
    }
}
