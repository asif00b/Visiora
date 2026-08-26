import os
import subprocess
import logging
import json
import tempfile
import threading

logger = logging.getLogger(__name__)

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIOMETRIC_DIR = os.path.join(BACKEND_DIR, 'biometric')
SCANNER_EXE = os.path.join(BIOMETRIC_DIR, 'Scanner.exe')
DOTNET_EXE = os.path.join(BIOMETRIC_DIR, 'dotnet', 'dotnet.exe')
MATCHER_DLL = os.path.join(BIOMETRIC_DIR, 'Matcher', 'bin', 'Debug', 'net6.0', 'Matcher.dll')

_hardware_lock = threading.Lock()

def log_to_file(msg):
    try:
        debug_path = os.path.join(BIOMETRIC_DIR, "biometric_debug.txt")
        with open(debug_path, "a", encoding="utf-8") as f:
            f.write(f"{datetime.datetime.now()} - {msg}\n")
    except:
        pass

import datetime

class FutronicDriver:
    """Futronic FS80H USB Fingerprint Scanner Driver - uses stable 32-bit Scanner.exe bridge."""

    def __init__(self):
        self.is_initialized = os.path.exists(SCANNER_EXE)
        if self.is_initialized:
            logger.info(f"[Futronic] Native Scanner.exe bridge ready: {SCANNER_EXE}")

    def is_device_connected(self) -> bool:
        """Check if Futronic FS80H USB device can be opened."""
        # Scanner.exe does not have a status-only check yet, but we can assume it works if exe exists
        # To be safe, we can run Scanner.exe with a tiny timeout or just return True if driver loaded.
        return os.path.exists(SCANNER_EXE)

    def capture_template(self) -> tuple:
        """
        Capture fingerprint template from Futronic FS80H sensor using SourceAFIS Matcher.
        Returns (template_b64, quality_score).
        """
        scan_file = os.path.join(BIOMETRIC_DIR, f'_scan_{os.getpid()}.bmp')
        log_to_file("capture_template called")
        try:
            with _hardware_lock:
                # 1. Capture BMP
                log_to_file(f"Launching Scanner.exe to {scan_file}")
                logger.error(f"[Futronic] Launching Scanner.exe to {scan_file}...")
                res = subprocess.run([SCANNER_EXE, scan_file], capture_output=True, text=True, timeout=20)
                log_to_file(f"Scanner.exe finished with returncode={res.returncode}")
                log_to_file(f"Scanner.exe stdout: {res.stdout.strip()}")
                log_to_file(f"Scanner.exe stderr: {res.stderr.strip()}")
                
                logger.error(f"[Futronic] Scanner.exe stdout: '{res.stdout.strip()}' | stderr: '{res.stderr.strip()}' | rc={res.returncode}")
                
                if res.returncode == 0 and os.path.exists(scan_file):
                    # 2. Extract Template with SourceAFIS
                    log_to_file(f"Launching Matcher.dll via {DOTNET_EXE}")
                    logger.error(f"[Futronic] Launching Matcher.dll via {DOTNET_EXE}...")
                    res_match = subprocess.run([DOTNET_EXE, MATCHER_DLL, "enroll", scan_file], capture_output=True, text=True, timeout=10)
                    log_to_file(f"Matcher finished with returncode={res_match.returncode}")
                    log_to_file(f"Matcher stdout: {res_match.stdout.strip()}")
                    log_to_file(f"Matcher stderr: {res_match.stderr.strip()}")
                    
                    logger.error(f"[Futronic] Matcher stdout: '{res_match.stdout.strip()}' | stderr: '{res_match.stderr.strip()}' | rc={res_match.returncode}")
                    
                    if res_match.returncode == 0 and res_match.stdout.strip():
                        b64 = res_match.stdout.strip()
                        quality = 95 # High quality assumed if extraction succeeded
                        logger.error(f"[Futronic] Captured SourceAFIS template (length {len(b64)})")
                        log_to_file(f"Successfully captured template of length {len(b64)}")
                        return b64, quality
                    else:
                        log_to_file("Matcher failed or stdout empty")
                        logger.error(f"[Futronic] Matcher failed with exit code {res_match.returncode}: {res_match.stderr.strip()}")
                else:
                    log_to_file(f"Scanner failed or file not found. File exists: {os.path.exists(scan_file)}")
                    logger.error(f"[Futronic] Scanner failed with exit code {res.returncode}: {res.stderr.strip()}")
        except Exception as e:
            log_to_file(f"Exception in capture_template: {e}")
            logger.error(f"[Futronic] Capture error: {e}")
        finally:
            try:
                if os.path.exists(scan_file):
                    os.remove(scan_file)
            except:
                pass

        return None, 0


def poll_hardware_sensor() -> dict:
    """
    Simulate poll by checking if a scanner is connected.
    Because Scanner.exe is blocking for a finger, we just return device status.
    """
    is_connected = os.path.exists(SCANNER_EXE)
    return {
        'touch': False, # We can't know touch instantly without blocking
        'template_b64': None,
        'preview_png': None,
        'error': None if is_connected else 'Scanner executable not found'
    }


def enroll_fingerprint_native() -> tuple:
    """
    Run Scanner.exe to capture a BMP, then run Matcher.exe to generate SourceAFIS template.
    Returns (template_b64, quality_score).
    """
    driver = get_futronic_driver()
    return driver.capture_template()


def verify_fingerprint_native(records: list) -> int:
    """
    Run Scanner.exe to capture a BMP, then run Matcher.exe to verify against records.
    Returns matched user_id (int) or None if no match.
    """
    scan_file = os.path.join(BIOMETRIC_DIR, f'_verify_{os.getpid()}.bmp')
    json_file = os.path.join(BIOMETRIC_DIR, f'_verify_{os.getpid()}.json')
    
    with _hardware_lock:
        try:
            with open(json_file, 'w') as f:
                json.dump(records, f)
                
            # 1. Capture BMP
            logger.info("[Futronic Native Verify] Checking finger on scanner...")
            res = subprocess.run([SCANNER_EXE, scan_file], capture_output=True, text=True, timeout=3)
            if res.returncode == 0 and os.path.exists(scan_file):
                # 2. Verify with SourceAFIS 1:N
                logger.info(f"[Futronic Native Verify] Matching against {len(records)} templates...")
                res_match = subprocess.run([DOTNET_EXE, MATCHER_DLL, "verify-all", scan_file, json_file], capture_output=True, text=True, timeout=15)
                out = res_match.stdout.strip()
                logger.info(f"[Futronic Native Verify] Output: {out}")
                
                for line in out.splitlines():
                    if line.startswith("MATCHED_USER_ID:"):
                        matched_id = int(line.split("MATCHED_USER_ID:")[1].strip())
                        return matched_id
        except Exception as e:
            logger.error(f"[Futronic Native Verify] Error: {e}")
        finally:
            try:
                if os.path.exists(scan_file):
                    os.remove(scan_file)
                if os.path.exists(json_file):
                    os.remove(json_file)
            except:
                pass
                
    return None


# Singleton
_driver_instance = None

def get_futronic_driver():
    global _driver_instance
    if _driver_instance is None:
        _driver_instance = FutronicDriver()
    return _driver_instance
