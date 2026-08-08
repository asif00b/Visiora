using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.IO;

[StructLayout(LayoutKind.Sequential)]
public struct FTR_DATA {
    public int dwSize;
    public IntPtr pData;
}

public class FutronicWrapper {
    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRInitialize();
    
    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern void FTRTerminate();
    
    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTREnroll(IntPtr usrContext, int purpose, ref FTR_DATA pTemplate);
    
    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRVerify(IntPtr usrContext, ref FTR_DATA pTemplate, out bool pResult, out int pVerifyResult);
    
    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRSetParam(int paramCode, int paramValue);

    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRSetParam(int paramCode, FTR_STATE_CB paramValue);
    
    [DllImport("FTRAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRGetParam(int paramCode, ref int pParamValue);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    public delegate void FTR_STATE_CB(IntPtr userContext, int stateMask, ref int response, int signal, IntPtr pBitmap);

    // Constants
    const int FTR_PARAM_MAX_TEMPLATE_SIZE = 6;
    
    // State masks
    const int FTR_STATE_EMPTY = 1;
    const int FTR_STATE_FRAME_PROVIDED = 2;
    const int FTR_STATE_ERROR = 4;
    
    const int FTR_SIGNAL_TOUCH_SENSOR = 1;
    const int FTR_SIGNAL_TAKE_OFF = 2;
    const int FTR_SIGNAL_FAKE_SOURCE = 3;

    static FTR_STATE_CB _callback = new FTR_STATE_CB(StateCallback);

    static void StateCallback(IntPtr userContext, int stateMask, ref int response, int signal, IntPtr pBitmap) {
        if (stateMask == FTR_STATE_EMPTY) {
            if (signal == FTR_SIGNAL_TOUCH_SENSOR) {
                Console.WriteLine("STATE: Put your finger");
            } else if (signal == FTR_SIGNAL_TAKE_OFF) {
                Console.WriteLine("STATE: Take off finger");
            } else if (signal == FTR_SIGNAL_FAKE_SOURCE) {
                Console.WriteLine("STATE: Fake finger detected");
            }
        } else if (stateMask == FTR_STATE_FRAME_PROVIDED) {
            Console.WriteLine("STATE: Frame captured");
        }
    }

    static int Enroll() {
        int res = FTRInitialize();
        if (res != 0) {
            Console.WriteLine("ERROR: FTRInitialize failed with " + res);
            return 1;
        }

        // Set Callback to Param 5
        FTRSetParam(5, _callback);

        // Try setting other common parameters to avoid hardware rejection
        // FTR_PARAM_FAKE_DETECT = 7 (0 = off)
        FTRSetParam(7, 0); 
        // FTR_PARAM_FAST_MODE = 11 (1 = on)
        FTRSetParam(11, 1);

        int maxSize = 0;
        FTRGetParam(FTR_PARAM_MAX_TEMPLATE_SIZE, ref maxSize);
        
        FTR_DATA template = new FTR_DATA();
        template.dwSize = maxSize;
        template.pData = Marshal.AllocHGlobal(maxSize);
        
        Console.WriteLine("STATE: Starting Enrollment");
        int enrollRes = FTREnroll(IntPtr.Zero, 1, ref template);
        
        if (enrollRes == 0 && template.dwSize > 0) {
            byte[] tmplBytes = new byte[template.dwSize];
            Marshal.Copy(template.pData, tmplBytes, 0, template.dwSize);
            Console.WriteLine("SUCCESS_TEMPLATE_B64:" + Convert.ToBase64String(tmplBytes));
        } else {
            Console.WriteLine("ERROR: FTREnroll returned " + enrollRes);
        }
        
        Marshal.FreeHGlobal(template.pData);
        FTRTerminate();
        return enrollRes == 0 ? 0 : 1;
    }

    static int Verify(string templateB64) {
        int res = FTRInitialize();
        if (res != 0) {
            Console.WriteLine("ERROR: FTRInitialize failed with " + res);
            return 1;
        }

        res = FTRSetParam(5, _callback);

        byte[] tmplBytes = Convert.FromBase64String(templateB64);
        FTR_DATA template = new FTR_DATA();
        template.dwSize = tmplBytes.Length;
        template.pData = Marshal.AllocHGlobal(tmplBytes.Length);
        Marshal.Copy(tmplBytes, 0, template.pData, tmplBytes.Length);
        
        Console.WriteLine("STATE: Starting Verification");
        bool bResult = false;
        int verifyRes = 0;
        int retCode = FTRVerify(IntPtr.Zero, ref template, out bResult, out verifyRes);
        
        if (retCode == 0) {
            if (bResult) {
                Console.WriteLine("MATCHED: TRUE");
            } else {
                Console.WriteLine("MATCHED: FALSE");
            }
        } else {
            Console.WriteLine("ERROR: FTRVerify returned " + retCode);
        }
        
        Marshal.FreeHGlobal(template.pData);
        FTRTerminate();
        return retCode == 0 ? 0 : 1;
    }

    static int Main(string[] args) {
        if (args.Length == 0) {
            Console.WriteLine("ERROR: Missing arguments");
            return 1;
        }

        if (args[0] == "enroll") {
            return Enroll();
        } else if (args[0] == "verify" && args.Length > 1) {
            // Check if argument is a file path
            if (File.Exists(args[1])) {
                return Verify(File.ReadAllText(args[1]));
            }
            return Verify(args[1]);
        }

        Console.WriteLine("ERROR: Invalid arguments");
        return 1;
    }
}
