using System;
using System.Runtime.InteropServices;
public class TestEnrollX {
    [StructLayout(LayoutKind.Sequential)]
    public struct FTR_DATA {
        public int dwSize;
        public IntPtr pData;
    }
    
    [StructLayout(LayoutKind.Sequential)]
    public struct FTR_ENROLL_DATA {
        public int dwSize;
        public int dwQuality;
    }

    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRInitialize();
    
    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTREnrollX(IntPtr usrContext, int purpose, ref FTR_ENROLL_DATA pEData, ref FTR_DATA pTemplate);

    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTREnroll(IntPtr usrContext, int purpose, ref FTR_DATA pTemplate);

    public static void Main() {
        FTRInitialize();
        
        FTR_DATA template = new FTR_DATA();
        template.dwSize = 3333; // typical FTR_PARAM_MAX_TEMPLATE_SIZE
        template.pData = Marshal.AllocHGlobal(3333);
        
        IntPtr dummyCtx = Marshal.AllocHGlobal(4);
        Marshal.WriteInt32(dummyCtx, 0);

        // Test FTREnroll
        for(int p = 0; p <= 3; p++) {
            int res1 = FTREnroll(IntPtr.Zero, p, ref template);
            int res2 = FTREnroll(dummyCtx, p, ref template);
            if (res1 != 3) Console.WriteLine("FTREnroll (IntPtr.Zero): purpose=" + p + ", res=" + res1);
            if (res2 != 3) Console.WriteLine("FTREnroll (dummyCtx): purpose=" + p + ", res=" + res2);
        }

        // Test FTREnrollX
        for(int s = 4; s <= 64; s += 4) {
            FTR_ENROLL_DATA enrollData = new FTR_ENROLL_DATA();
            enrollData.dwSize = s;
            for(int p = 0; p <= 3; p++) {
                int res1 = FTREnrollX(IntPtr.Zero, p, ref enrollData, ref template);
                int res2 = FTREnrollX(dummyCtx, p, ref enrollData, ref template);
                if (res1 != 3) Console.WriteLine("FTREnrollX (IntPtr.Zero): size=" + s + ", purpose=" + p + ", res=" + res1);
                if (res2 != 3) Console.WriteLine("FTREnrollX (dummyCtx): size=" + s + ", purpose=" + p + ", res=" + res2);
            }
        }
    }
}