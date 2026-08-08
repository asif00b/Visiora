using System;
using System.Runtime.InteropServices;
public class TestCallbackParam {
    [StructLayout(LayoutKind.Sequential)]
    public struct FTR_DATA {
        public int dwSize;
        public IntPtr pData;
    }
    
    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRInitialize();
    
    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern void FTRTerminate();
    
    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRSetParam(int paramCode, IntPtr paramValue);
    
    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTREnroll(IntPtr usrContext, int purpose, ref FTR_DATA pTemplate);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    public delegate void FTR_STATE_CB(IntPtr userContext, int stateMask, ref int response, int signal, IntPtr pBitmap);

    static void StateCallback(IntPtr userContext, int stateMask, ref int response, int signal, IntPtr pBitmap) {}

    public static void Main() {
        FTR_STATE_CB cb = new FTR_STATE_CB(StateCallback);
        IntPtr cbPtr = Marshal.GetFunctionPointerForDelegate(cb);
        
        FTR_DATA template = new FTR_DATA();
        template.dwSize = 3333;
        template.pData = Marshal.AllocHGlobal(3333);
        
        for(int p = 1; p <= 30; p++) {
            FTRInitialize();
            FTRSetParam(p, cbPtr);
            int res = FTREnroll(IntPtr.Zero, 1, ref template);
            if (res != 201 && res != 4) {
                Console.WriteLine("FOUND IT! Param " + p + " made FTREnroll return " + res);
            }
            FTRTerminate();
        }
    }
}