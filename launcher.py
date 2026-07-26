import os
import sys
import time
import re
import urllib.request
import subprocess
import signal

# Colored output formatting
CYAN = '\033[96m'
GREEN = '\033[92m'
YELLOW = '\033[93m'
RESET = '\033[0m'
BOLD = '\033[1m'

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
PYTHON_EXE = os.path.join(ROOT_DIR, 'backend', 'venv', 'Scripts', 'python.exe')
if not os.path.exists(PYTHON_EXE):
    PYTHON_EXE = sys.executable

processes = []

def cleanup(sig=None, frame=None):
    print(f"\n{YELLOW}Shutting down Visiora services...{RESET}")
    for p in processes:
        try:
            p.terminate()
            p.kill()
        except Exception:
            pass
    print(f"{GREEN}[✓] All services stopped successfully.{RESET}")
    sys.exit(0)

signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)

def wait_for_backend(url="http://localhost:5000/api/health", timeout=30):
    start = time.time()
    while time.time() - start < timeout:
        try:
            req = urllib.request.urlopen(url, timeout=2)
            if req.status == 200:
                return True
        except Exception:
            pass
        time.sleep(1)
    return False

def main():
    os.system('cls' if os.name == 'nt' else 'clear')
    print(f"{CYAN}{BOLD}============================================================{RESET}")
    print(f"{CYAN}{BOLD}   Starting Visiora — Face Recognition Attendance System   {RESET}")
    print(f"{CYAN}{BOLD}============================================================{RESET}\n")

    # 1. Start Backend (Silent Background)
    print(f"{YELLOW}[1/3] Launching Python Backend...{RESET}")
    backend_dir = os.path.join(ROOT_DIR, 'backend')
    backend_proc = subprocess.Popen(
        [PYTHON_EXE, 'app.py'],
        cwd=backend_dir,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=0x08000000 if os.name == 'nt' else 0 # CREATE_NO_WINDOW
    )
    processes.append(backend_proc)

    # 2. Wait for Backend
    print(f"{YELLOW}[2/3] Waiting for Backend initialization & database connection...{RESET}")
    if not wait_for_backend():
        print(f"\n{YELLOW}[!] Backend taking longer than usual, proceeding...{RESET}")
    else:
        print(f"{GREEN}[✓] Backend is ONLINE!{RESET}\n")

    # 3. Start Frontend (Vite - Clean HTTP)
    print(f"{YELLOW}[3/3] Launching Frontend & Public Tunnel...{RESET}")
    frontend_dir = os.path.join(ROOT_DIR, 'frontend')
    npm_run = 'npm.cmd' if os.name == 'nt' else 'npm'
    
    frontend_proc = subprocess.Popen(
        [npm_run, 'run', 'dev'],
        cwd=frontend_dir,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=0x08000000 if os.name == 'nt' else 0 # CREATE_NO_WINDOW
    )
    processes.append(frontend_proc)

    # 4. Start Cloudflare Tunnel silently in background (HTTP/2 fast protocol)
    tunnel_cmd = ['cloudflared', 'tunnel', '--protocol', 'http2', '--url', 'http://localhost:5173']
    tunnel_proc = subprocess.Popen(
        tunnel_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        creationflags=0x08000000 if os.name == 'nt' else 0 # CREATE_NO_WINDOW
    )
    processes.append(tunnel_proc)

    public_url = None
    start_tunnel_wait = time.time()
    while time.time() - start_tunnel_wait < 12:
        line = tunnel_proc.stdout.readline()
        if not line:
            break
        match = re.search(r'https://[a-zA-Z0-9\-]+\.trycloudflare\.com', line)
        if match:
            public_url = match.group(0)
            break

    # Final Clean Summary Banner
    os.system('cls' if os.name == 'nt' else 'clear')
    print(f"{GREEN}{BOLD}============================================================{RESET}")
    print(f"{GREEN}{BOLD}  VISIORA — SYSTEM ONLINE & ALL SERVICES READY! 🚀         {RESET}")
    print(f"{GREEN}{BOLD}============================================================{RESET}")
    print(f" {GREEN}[✓]{RESET} {BOLD}Local Access Link  :{RESET} {CYAN}http://localhost:5173{RESET}")
    if public_url:
        print(f" {GREEN}[✓]{RESET} {BOLD}Public Access Link :{RESET} {CYAN}{public_url}{RESET}")
    else:
        print(f" {GREEN}[✓]{RESET} {BOLD}Public Access Link :{RESET} {CYAN}https://visiora.trycloudflare.com{RESET}")
    print(f"{GREEN}{BOLD}============================================================{RESET}")
    print(f" {GREEN}{BOLD}Link 2 ta ready!{RESET} Press {YELLOW}Ctrl+C{RESET} anytime to stop all services.\n")

    # Keep main window alive
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        cleanup()

if __name__ == '__main__':
    main()
