using System;
using System.Runtime.InteropServices;
public class TestParams {
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    public delegate void FTR_STATE_CB(IntPtr userContext, int stateMask, ref int response, int signal, IntPtr pBitmap);
    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRSetParam(int paramCode, FTR_STATE_CB paramValue);
    static void StateCallback(IntPtr userContext, int stateMask, ref int response, int signal, IntPtr pBitmap) {}
    public static void Main() {
        FTR_STATE_CB cb = new FTR_STATE_CB(StateCallback);
        for(int i=1; i<20; i++) {
            try {
                int res = FTRSetParam(i, cb);
                if(res == 0) Console.WriteLine("Param " + i + " accepted callback.");
            } catch {}
        }
    }
}