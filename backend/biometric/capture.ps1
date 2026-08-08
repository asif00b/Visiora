$dllPath = "d:\NUB\Final Project\Attendence System\Version 6\backend\ftrScanAPI.dll"

$code = @"
using System;
using System.IO;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct FTRSCAN_IMAGE_SIZE {
    public int nWidth;
    public int nHeight;
    public int nImageSize;
}

public class FutronicBridge {
    [DllImport(@"$dllPath", CallingConvention = CallingConvention.StdCall)]
    public static extern IntPtr ftrScanOpenDevice();

    [DllImport(@"$dllPath", CallingConvention = CallingConvention.StdCall)]
    public static extern void ftrScanCloseDevice(IntPtr hDevice);

    [DllImport(@"$dllPath", CallingConvention = CallingConvention.StdCall)]
    public static extern bool ftrScanGetImageSize(IntPtr hDevice, out FTRSCAN_IMAGE_SIZE pImageSize);

    [DllImport(@"$dllPath", CallingConvention = CallingConvention.StdCall)]
    public static extern bool ftrScanGetFrame(IntPtr hDevice, int nDose, byte[] pFrame);

    [DllImport(@"$dllPath", CallingConvention = CallingConvention.StdCall)]
    public static extern bool ftrScanGetImage(IntPtr hDevice, int nDose, byte[] pFrame);
}
"@

Add-Type -TypeDefinition $code

$h = [FutronicBridge]::ftrScanOpenDevice()
if ($h -ne [IntPtr]::Zero) {
    $sz = New-Object FTRSCAN_IMAGE_SIZE
    $ok = [FutronicBridge]::ftrScanGetImageSize($h, [ref]$sz)
    $bufLen = 153600
    if ($sz.nImageSize -gt 0) { $bufLen = $sz.nImageSize }
    
    $buf = New-Object byte[] $bufLen
    
    # Try GetFrame with dose 4
    $gotFrame = [FutronicBridge]::ftrScanGetFrame($h, 4, $buf)
    if (-not $gotFrame) {
        # Fallback to GetImage
        $gotFrame = [FutronicBridge]::ftrScanGetImage($h, 4, $buf)
    }
    
    [FutronicBridge]::ftrScanCloseDevice($h)
    
    if ($gotFrame) {
        [System.IO.File]::WriteAllBytes($args[0], $buf)
        Write-Host "CAPTURE_OK"
    } else {
        # Write default or empty buffer so we still get a frame
        [System.IO.File]::WriteAllBytes($args[0], $buf)
        Write-Host "CAPTURE_OK_EMPTY"
    }
} else {
    Write-Host "DEVICE_OFFLINE"
}
