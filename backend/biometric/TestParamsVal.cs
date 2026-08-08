using System;
using System.Runtime.InteropServices;
public class TestParams {
    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRSetParam(int paramCode, int paramValue);
    public static void Main() {
        for(int i=0; i<5; i++) {
            int res = FTRSetParam(4, i);
            Console.WriteLine("Param 4 with value " + i + " returned " + res);
        }
    }
}