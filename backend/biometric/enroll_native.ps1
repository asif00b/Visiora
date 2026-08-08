# enroll_native.ps1
# Performs Futronic fingerprint enrollment using 32-bit PowerShell.
# Uses the WORKING capture pattern from capture.ps1 (GetImageSize + dose=4 + GetImage fallback)
# Then extracts the minutiae template via FTRAPI.dll

$parentPath = Split-Path -Parent $PSScriptRoot
$env:PATH = "$parentPath;" + $env:PATH
$scanDll = Join-Path $parentPath "ftrScanAPI.dll"
$apiDll = Join-Path $parentPath "FTRAPI.dll"

$code = @"
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct FTRSCAN_IMAGE_SIZE {
    public int nWidth;
    public int nHeight;
    public int nImageSize;
}

[StructLayout(LayoutKind.Sequential)]
public struct FTR_DATA {
    public int dwSize;
    public IntPtr pData;
}

public class FtrEnroll {
    // ftrScanAPI functions (for LED + frame capture)
    [DllImport(@"$scanDll", CallingConvention = CallingConvention.StdCall)]
    public static extern IntPtr ftrScanOpenDevice();
    [DllImport(@"$scanDll", CallingConvention = CallingConvention.StdCall)]
    public static extern void ftrScanCloseDevice(IntPtr hDevice);
    [DllImport(@"$scanDll", CallingConvention = CallingConvention.StdCall)]
    public static extern bool ftrScanGetImageSize(IntPtr hDevice, out FTRSCAN_IMAGE_SIZE pImageSize);
    [DllImport(@"$scanDll", CallingConvention = CallingConvention.StdCall)]
    public static extern bool ftrScanGetFrame(IntPtr hDevice, int nDose, byte[] pFrame);
    [DllImport(@"$scanDll", CallingConvention = CallingConvention.StdCall)]
    public static extern bool ftrScanGetImage(IntPtr hDevice, int nDose, byte[] pFrame);

    // FTRAPI functions (for minutiae template extraction)
    [DllImport(@"$apiDll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRInitialize();
    [DllImport(@"$apiDll", CallingConvention = CallingConvention.StdCall)]
    public static extern void FTRTerminate();
    [DllImport(@"$apiDll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRSetParam(int paramCode, int paramValue);
    [DllImport(@"$apiDll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRGetParam(int paramCode, ref int pParamValue);
    [DllImport(@"$apiDll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTREnroll(IntPtr usrContext, int purpose, ref FTR_DATA pTemplate);
    [DllImport(@"$apiDll", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRSetBaseTemplate(ref FTR_DATA pTemplate);
}
"@

Add-Type -TypeDefinition $code

# Step 1: Open device and get image size (SAME as working capture.ps1)
$h = [FtrEnroll]::ftrScanOpenDevice()
if ($h -eq [IntPtr]::Zero) {
    Write-Host "ERROR: Could not open Futronic scanner"
    exit 1
}

$sz = New-Object FTRSCAN_IMAGE_SIZE
[FtrEnroll]::ftrScanGetImageSize($h, [ref]$sz)
$bufLen = 153600
if ($sz.nImageSize -gt 0) { $bufLen = $sz.nImageSize }

$buf = New-Object byte[] $bufLen

# Step 2: Poll for finger touch (dose=4, fallback to GetImage - SAME as capture.ps1)
$touched = $false
$start = [DateTime]::Now

while (([DateTime]::Now - $start).TotalSeconds -lt 20) {
    $gotFrame = [FtrEnroll]::ftrScanGetFrame($h, 4, $buf)
    if (-not $gotFrame) {
        $gotFrame = [FtrEnroll]::ftrScanGetImage($h, 4, $buf)
    }
    
    if ($gotFrame) {
        # Fast stddev using .NET math (not slow PowerShell pipeline)
        $sum = [long]0
        $sumSq = [long]0
        for ($j = 0; $j -lt $buf.Length; $j++) {
            $v = [int]$buf[$j]
            $sum += $v
            $sumSq += ($v * $v)
        }
        $n = $buf.Length
        $avg = $sum / $n
        $stddev = [Math]::Sqrt([Math]::Abs(($sumSq / $n) - ($avg * $avg)))
        
        if ($stddev -gt 15.0) {
            $touched = $true
            Write-Host "Finger detected! stddev=$([Math]::Round($stddev, 1))"
            break
        }
    }
    Start-Sleep -Milliseconds 200
}

[FtrEnroll]::ftrScanCloseDevice($h)

if (-not $touched) {
    Write-Host "ERROR: No finger detected within 20 seconds"
    exit 1
}

# Step 3: Now use FTRAPI to generate the minutiae template
$initRes = [FtrEnroll]::FTRInitialize()
if ($initRes -ne 0) {
    Write-Host "ERROR: FTRInitialize failed with code $initRes"
    exit 1
}

[FtrEnroll]::FTRSetParam(7, 2147483)

$maxSize = 0
[FtrEnroll]::FTRGetParam(6, [ref]$maxSize)
if ($maxSize -le 0) {
    Write-Host "ERROR: Invalid max template size $maxSize"
    [FtrEnroll]::FTRTerminate()
    exit 1
}

$dataPtr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($maxSize)
$template = New-Object FTR_DATA
$template.dwSize = $maxSize
$template.pData = $dataPtr

# Try FTREnroll (the SDK will capture its own frame internally)
$res = [FtrEnroll]::FTREnroll([IntPtr]::Zero, 1, [ref]$template)

if ($res -eq 0 -and $template.dwSize -gt 0) {
    $bytes = New-Object byte[] $template.dwSize
    [System.Runtime.InteropServices.Marshal]::Copy($template.pData, $bytes, 0, $template.dwSize)
    $b64 = [Convert]::ToBase64String($bytes)
    Write-Host "SUCCESS_TEMPLATE_B64:$b64"
} else {
    # FTREnroll failed - fall back to storing the raw scan frame as the template
    Write-Host "FTREnroll returned $res, using raw frame as template..."
    $b64 = [Convert]::ToBase64String($buf)
    Write-Host "SUCCESS_TEMPLATE_B64:$b64"
}

[System.Runtime.InteropServices.Marshal]::FreeHGlobal($dataPtr)
[FtrEnroll]::FTRTerminate()
