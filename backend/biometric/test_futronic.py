import subprocess
import os
import json
import time

def run_scanner(output_path):
    print("Please place your finger on the scanner...")
    # Run Scanner.exe
    process = subprocess.Popen(["Scanner.exe", output_path], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    
    while True:
        line = process.stdout.readline()
        if not line and process.poll() is not None:
            break
        line = line.strip()
        if line:
            print(f"[Scanner] {line}")
            if "SUCCESS" in line:
                return True
            if "ERROR" in line:
                return False
    return False

def run_matcher_enroll(bmp_path):
    print("Extracting minutiae with SourceAFIS...")
    dotnet_exe = os.path.join("dotnet", "dotnet.exe")
    matcher_dll = os.path.join("Matcher", "bin", "Debug", "net6.0", "Matcher.dll")
    result = subprocess.run([dotnet_exe, matcher_dll, "enroll", bmp_path], capture_output=True, text=True)
    
    if result.returncode == 0:
        return result.stdout.strip()
    else:
        print("[Matcher Error] " + result.stderr)
        return None

def run_matcher_verify(probe_bmp_path, candidate_json_path):
    print("Verifying fingerprint...")
    dotnet_exe = os.path.join("dotnet", "dotnet.exe")
    matcher_dll = os.path.join("Matcher", "bin", "Debug", "net6.0", "Matcher.dll")
    result = subprocess.run([dotnet_exe, matcher_dll, "verify-all", probe_bmp_path, candidate_json_path], capture_output=True, text=True)
    
    if result.returncode == 0:
        return result.stdout.strip()
    else:
        print("[Matcher Error] " + result.stderr)
        return None

def main():
    print("--- New SourceAFIS Fingerprint Test Suite ---")
    
    # 1. Enroll
    enroll_bmp = "test_enroll.bmp"
    if not run_scanner(enroll_bmp):
        print("Enrollment capture failed.")
        return
        
    template_b64 = run_matcher_enroll(enroll_bmp)
    if not template_b64:
        print("Failed to generate template.")
        return
        
    print(f"Generated Template Length: {len(template_b64)} characters")
    
    # Save template to file for verification
    template_file = "test_template.txt"
    with open(template_file, "w") as f:
        f.write(template_b64)
        
    print("Enrollment successful! Please remove your finger.")
    time.sleep(3)
    
    # 2. Verify
    print("\n--- Verification Phase ---")
    verify_bmp = "test_verify.bmp"
    if not run_scanner(verify_bmp):
        print("Verification capture failed.")
        return
        
    score = run_matcher_verify(verify_bmp, template_file)
    print(f"Match Score: {score}")
    
    if score >= 40.0:
        print("Verification SUCCESSFUL! Fingerprint matches.")
    else:
        print("Verification FAILED! Fingerprint does not match.")

if __name__ == "__main__":
    main()
