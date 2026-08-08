# verify_native.ps1
# Performs Futronic fingerprint verification by matching the live finger against
# a list of pre-registered templates stored in a JSON file.
# Must be executed using 32-bit PowerShell.
# USAGE: powershell.exe -File verify_native.ps1 <path_to_json_file>

$jsonPath = $args[0]
if (-not $jsonPath -or -not (Test-Path $jsonPath)) {
    Write-Host "ERROR: Missing templates JSON file path"
    exit 1
}

# Parse registered templates
$records = Get-Content $jsonPath -Raw | ConvertFrom-Json
if ($records.Count -eq 0) {
    Write-Host "ERROR: No templates provided in JSON file"
    exit 1
}

$parentPath = Split-Path -Parent $PSScriptRoot
$env:PATH = "$parentPath;" + $env:PATH
$dllPath = Join-Path $parentPath "FTRAPI.dll"

$code = @"
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct FTR_DATA {
    public int dwSize;
    public IntPtr pData;
}

public class FtrApi {
    [DllImport(@"$dllPath", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRInitialize();
    
    [DllImport(@"$dllPath", CallingConvention = CallingConvention.StdCall)]
    public static extern void FTRTerminate();
    
    [DllImport(@"$dllPath", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRSetParam(int paramCode, int paramValue);
    
    [DllImport(@"$dllPath", CallingConvention = CallingConvention.StdCall)]
    public static extern int FTRVerify(IntPtr usrContext, ref FTR_DATA pTemplate, ref int pbIsVerified, ref int pFARVerify);
}
"@

Add-Type -TypeDefinition $code

# Initialize SDK
$initRes = [FtrApi]::FTRInitialize()
if ($initRes -ne 0) {
    Write-Host "ERROR: FTRInitialize failed with code $initRes"
    exit 1
}



# Set FAR requested threshold to 1 in 1,000 (code 7, value 2147483) for high security matching
[FtrApi]::FTRSetParam(7, 2147483)

$matchedUserId = $null

# Loop through each template and verify against it
# The first call to FTRVerify will block and wait until a finger is placed on the scanner.
# Subsequent calls in the loop will run instantaneously using the same captured frame as long as the finger is kept on the glass.
foreach ($rec in $records) {
    try {
        $bytes = [Convert]::FromBase64String($rec.templateB64)
        $size = $bytes.Length
        
        # Native SDK templates are 1KB - 3.5KB. Skip raw 153KB sensor images to avoid false positive matches.
        if ($size -gt 15000 -or $size -lt 50) {
            Write-Host "WARNING: Skipping invalid/legacy template size ($size bytes) for user $($rec.userId)"
            continue
        }
        
        # Allocate memory
        $ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($size)
        [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $size)
        
        $t = New-Object FTR_DATA
        $t.dwSize = $size
        $t.pData = $ptr
        
        $isVerified = 0
        $far = 0
        
        # Perform 1-to-1 match
        $res = [FtrApi]::FTRVerify([IntPtr]::Zero, [ref]$t, [ref]$isVerified, [ref]$far)
        
        # Free allocated unmanaged memory
        [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
        
        # If successfully verified, record the matched user ID and break the loop
        if ($res -eq 0 -and $isVerified -ne 0) {
            $matchedUserId = $rec.userId
            break
        }
    } catch {
        # Log error for corrupt templates but continue looping to other templates
        Write-Host "WARNING: Failed processing template for user $($rec.userId): $_"
    }
}

# Terminate SDK session
[FtrApi]::FTRTerminate()

# Output the final result to stdout
if ($matchedUserId -ne $null) {
    Write-Host "MATCHED_USER_ID:$matchedUserId"
} else {
    Write-Host "NO_MATCH"
}
