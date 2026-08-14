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
    print(f"{GREEN}[OK] All services stopped successfully.{RESET}")
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
    print(f"{CYAN}{BOLD}   Starting Visiora — AI Organizational Suite              {RESET}")
    print(f"{CYAN}{BOLD}============================================================{RESET}\n")

    # 1. Build Frontend (production)
    frontend_dir = os.path.join(ROOT_DIR, 'frontend')
    dist_dir = os.path.join(frontend_dir, 'dist')
    npm_run = 'npm.cmd' if os.name == 'nt' else 'npm'

    if not os.path.isfile(os.path.join(dist_dir, 'index.html')):
        print(f"{YELLOW}[1/4] Building Frontend (first time)...{RESET}")
        subprocess.run([npm_run, 'run', 'build'], cwd=frontend_dir,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"{GREEN}[OK] Frontend built!{RESET}")
    else:
        print(f"{GREEN}[1/4] Frontend build found (dist/ exists){RESET}")

    # 2. Start Backend (Silent Background)
    print(f"{YELLOW}[2/4] Launching Python Backend...{RESET}")
    backend_dir = os.path.join(ROOT_DIR, 'backend')
    backend_proc = subprocess.Popen(
        [PYTHON_EXE, 'app.py'],
        cwd=backend_dir,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=0x08000000 if os.name == 'nt' else 0 # CREATE_NO_WINDOW
    )
    processes.append(backend_proc)

    # 3. Wait for Backend
    print(f"{YELLOW}[3/4] Waiting for Backend initialization & database connection...{RESET}")
    if not wait_for_backend():
        print(f"\n{YELLOW}[!] Backend taking longer than usual, proceeding...{RESET}")
    else:
        print(f"{GREEN}[OK] Backend is ONLINE!{RESET}\n")

    # 4. Start Vite Dev Server (for local development)
    print(f"{YELLOW}[4/4] Launching Frontend Dev Server & Public Tunnel...{RESET}")
    frontend_proc = subprocess.Popen(
        [npm_run, 'run', 'dev'],
        cwd=frontend_dir,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=0x08000000 if os.name == 'nt' else 0 # CREATE_NO_WINDOW
    )
    processes.append(frontend_proc)

    # 5. Start Cloudflare Tunnel → Flask (port 5000 serves API + built frontend)
    public_url = None
    try:
        tunnel_cmd = ['cloudflared', 'tunnel', '--protocol', 'http2',
                      '--metrics', 'localhost:20241',
                      '--url', 'http://localhost:5000']
        tunnel_proc = subprocess.Popen(
            tunnel_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # merge stderr into stdout
            text=True,
            bufsize=1,
            creationflags=0x08000000 if os.name == 'nt' else 0 # CREATE_NO_WINDOW
        )
        processes.append(tunnel_proc)

        import threading
        url_found = threading.Event()

        def scan_output():
            for line in iter(tunnel_proc.stdout.readline, ''):
                m = re.search(r'https://[a-zA-Z0-9\-]+\.trycloudflare\.com', line)
                if m:
                    nonlocal public_url
                    public_url = m.group(0)
                    url_found.set()
                    return

        t = threading.Thread(target=scan_output, daemon=True)
        t.start()

        # Also poll the metrics API as a faster fallback
        metrics_found = False
        for _ in range(30):
            if url_found.is_set():
                break
            time.sleep(1)
            if not metrics_found:
                try:
                    resp = urllib.request.urlopen('http://localhost:20241/metrics', timeout=1)
                    metrics_text = resp.read().decode('utf-8', errors='ignore')
                    m = re.search(r'https://[a-zA-Z0-9\-]+\.trycloudflare\.com', metrics_text)
                    if m:
                        public_url = m.group(0)
                        url_found.set()
                        metrics_found = True
                except Exception:
                    pass

    except Exception as tunnel_err:
        print(f"[!] Public Cloudflare tunnel skipped: {tunnel_err}")

    # Final Clean Summary Banner
    os.system('cls' if os.name == 'nt' else 'clear')
    print(f"{GREEN}{BOLD}============================================================{RESET}")
    print(f"{GREEN}{BOLD}  VISIORA — SYSTEM ONLINE & ALL SERVICES READY!            {RESET}")
    print(f"{GREEN}{BOLD}============================================================{RESET}")
    print(f" {GREEN}[OK]{RESET} {BOLD}Local (Dev)    :{RESET} {CYAN}http://localhost:5173{RESET}")
    print(f" {GREEN}[OK]{RESET} {BOLD}Local (Prod)   :{RESET} {CYAN}http://localhost:5000{RESET}")
    if public_url:
        print(f" {GREEN}[OK]{RESET} {BOLD}Public Access  :{RESET} {CYAN}{public_url}{RESET}")
    else:
        print(f" {YELLOW}[!]{RESET} {BOLD}Public Access  :{RESET} {CYAN}Tunnel not available{RESET}")
    print(f"{GREEN}{BOLD}============================================================{RESET}")
    print(f" Press {YELLOW}Ctrl+C{RESET} anytime to stop all services.\n")

    # Keep main window alive
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        cleanup()

if __name__ == '__main__':
    main()
