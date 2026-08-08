using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

[StructLayout(LayoutKind.Sequential)]
public struct FTRSCAN_IMAGE_SIZE {
    public int nWidth;
    public int nHeight;
    public int nImageSize;
}

public class Scanner {
    [DllImport("ftrScanAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern IntPtr ftrScanOpenDevice();

    [DllImport("ftrScanAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern void ftrScanCloseDevice(IntPtr hDevice);

    [DllImport("ftrScanAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern bool ftrScanGetImageSize(IntPtr hDevice, out FTRSCAN_IMAGE_SIZE pImageSize);

    [DllImport("ftrScanAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern bool ftrScanGetFrame(IntPtr hDevice, int nDose, byte[] pFrame);

    [DllImport("ftrScanAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern bool ftrScanGetImage(IntPtr hDevice, int nDose, byte[] pFrame);

    [DllImport("ftrScanAPI.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern bool ftrScanIsFingerPresent(IntPtr hDevice, out FTRSCAN_FRAME_PARAMETERS pFrameParameters);
    
    [StructLayout(LayoutKind.Sequential)]
    public struct FTRSCAN_FRAME_PARAMETERS {
        public int nContrastOnDose2;
        public int nContrastOnDose4;
        public int nDose;
        public int nBrightnessOnFakeDose;
        public int nCrossRoN;
    }

    public static void SaveBitmap(string filePath, byte[] rawImage, int width, int height) {
        int stride = ((width + 3) / 4) * 4; // 4-byte aligned
        int rawSize = stride * height;
        
        using (FileStream fs = new FileStream(filePath, FileMode.Create))
        using (BinaryWriter bw = new BinaryWriter(fs)) {
            // BITMAPFILEHEADER
            bw.Write((ushort)0x4D42); // "BM"
            bw.Write(14 + 40 + 256 * 4 + rawSize); // File size
            bw.Write((ushort)0); // Reserved1
            bw.Write((ushort)0); // Reserved2
            bw.Write(14 + 40 + 256 * 4); // Pixel data offset

            // BITMAPINFOHEADER
            bw.Write(40); // Header size
            bw.Write(width);
            bw.Write(-height); // Top-down
            bw.Write((ushort)1); // Planes
            bw.Write((ushort)8); // 8 bpp
            bw.Write(0); // BI_RGB
            bw.Write(rawSize);
            bw.Write(0); // X pixels per meter
            bw.Write(0); // Y pixels per meter
            bw.Write(256); // Colors used
            bw.Write(256); // Colors important

            // Palette (Grayscale)
            for (int i = 0; i < 256; i++) {
                bw.Write((byte)i); // Blue
                bw.Write((byte)i); // Green
                bw.Write((byte)i); // Red
                bw.Write((byte)0); // Reserved
            }

            // Pixel Data
            for (int y = 0; y < height; y++) {
                int srcOffset = y * width;
                bw.Write(rawImage, srcOffset, width);
                // Padding
                for (int p = 0; p < stride - width; p++) {
                    bw.Write((byte)0);
                }
            }
        }
    }

    static void Main(string[] args) {
        if (args.Length < 1) {
            Console.WriteLine("Usage: Scanner.exe <output_bmp_path>");
            return;
        }
        
        string outPath = args[0];

        Console.WriteLine("STATE: WAIT_FINGER");
        
        bool fingerDetected = false;
        double contrastThreshold = 15.0;
        byte[] buf = new byte[153600];
        int finalWidth = 320;
        int finalHeight = 480;

        for (int i = 0; i < 75; i++) { // Wait up to 15 seconds
            IntPtr hDev = ftrScanOpenDevice();
            if (hDev != IntPtr.Zero) {
                FTRSCAN_IMAGE_SIZE sz = new FTRSCAN_IMAGE_SIZE();
                if (ftrScanGetImageSize(hDev, out sz)) {
                    finalWidth = sz.nWidth;
                    finalHeight = sz.nHeight;
                    int size = sz.nImageSize > 0 ? sz.nImageSize : 153600;
                    if (buf.Length != size) buf = new byte[size];
                }
                
                bool ok = ftrScanGetImage(hDev, 4, buf);
                
                ftrScanCloseDevice(hDev);

                if (ok) {
                    double sum = 0;
                    for (int p = 0; p < buf.Length; p++) sum += buf[p];
                    double avg = sum / buf.Length;
                    
                    if (avg >= 35.0) {
                        fingerDetected = true;
                        break;
                    }
                }
            }
            Thread.Sleep(200);
        }
        
        if (!fingerDetected) {
            Console.WriteLine("ERROR: TIMEOUT");
            return;
        }

        Console.WriteLine("STATE: CAPTURING");
        SaveBitmap(outPath, buf, finalWidth, finalHeight);
        Console.WriteLine("SUCCESS: " + outPath);
    }
}
