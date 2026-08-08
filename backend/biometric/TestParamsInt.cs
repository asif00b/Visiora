using System;
using System.Runtime.InteropServices;
public class TestParams {
    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRSetParam(int paramCode, int paramValue);
    public static void Main() {
        for(int i=1; i<20; i++) {
            try {
                int res = FTRSetParam(i, 0);
                if(res == 0) Console.WriteLine("Param " + i + " accepted int 0.");
            } catch {}
        }
    }
}