#!/usr/bin/env python3
"""
Photon Web Dashboard & API Bridge
Connects the Photon CLI reconnaissance engine with a modern web UI.
"""

import os
import sys
import json
import time
import signal
import socket
import argparse
import threading
import subprocess
from urllib.parse import urlparse, parse_qs
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, 'web')
VENV_PYTHON = os.path.join(BASE_DIR, 'venv', 'bin', 'python')
PYTHON_EXE = VENV_PYTHON if os.path.exists(VENV_PYTHON) else sys.executable

# Global Scan State Manager
class ScanManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.process = None
        self.status = "idle"  # idle, running, completed, stopped, failed
        self.logs = []
        self.target_name = ""
        self.target_url = ""
        self.start_time = None
        self.end_time = None
        self.return_code = None

    def start_scan(self, config):
        with self.lock:
            if self.process and self.process.poll() is None:
                return False, "A scan is already in progress."

            url = config.get("url", "").strip()
            if not url:
                return False, "Target URL is required."

            # Determine target folder name based on domain
            parsed = urlparse(url)
            host = parsed.netloc or parsed.path.split('/')[0]
            # Strip port if present
            folder_name = host.split(':')[0]
            if not folder_name:
                folder_name = "target"

            self.target_name = folder_name
            self.target_url = url
            self.logs = []
            self.status = "running"
            self.start_time = time.time()
            self.end_time = None
            self.return_code = None

            cmd = [
                PYTHON_EXE,
                os.path.join(BASE_DIR, "photon.py"),
                "-u", url,
                "-e", "json"
            ]

            level = config.get("level")
            if level:
                cmd.extend(["-l", str(level)])

            threads = config.get("threads")
            if threads:
                cmd.extend(["-t", str(threads)])

            delay = config.get("delay")
            if delay and float(delay) > 0:
                cmd.extend(["-d", str(delay)])

            timeout = config.get("timeout")
            if timeout and float(timeout) > 0:
                cmd.extend(["--timeout", str(timeout)])

            cookie = config.get("cookie", "").strip()
            if cookie:
                cmd.extend(["-c", cookie])

            regex = config.get("regex", "").strip()
            if regex:
                cmd.extend(["-r", regex])

            exclude = config.get("exclude", "").strip()
            if exclude:
                cmd.extend(["--exclude", exclude])

            proxy = config.get("proxy", "").strip()
            if proxy:
                cmd.extend(["-p", proxy])

            seeds = config.get("seeds", "").strip()
            if seeds:
                cmd.extend(["-s"] + seeds.split())

            user_agent = config.get("user_agent", "").strip()
            if user_agent:
                cmd.extend(["--user-agent", user_agent])

            if config.get("keys"):
                cmd.append("--keys")
            if config.get("wayback"):
                cmd.append("--wayback")
            if config.get("dns"):
                cmd.append("--dns")
            if config.get("clone"):
                cmd.append("--clone")
            if config.get("only_urls"):
                cmd.append("--only-urls")

            try:
                self.process = subprocess.Popen(
                    cmd,
                    cwd=BASE_DIR,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1
                )
            except Exception as e:
                self.status = "failed"
                return False, f"Failed to start Photon: {str(e)}"

            # Start background reader thread
            reader_thread = threading.Thread(target=self._read_output, daemon=True)
            reader_thread.start()

            return True, {
                "target": self.target_name,
                "pid": self.process.pid,
                "command": " ".join(cmd)
            }

    def _read_output(self):
        try:
            for line in iter(self.process.stdout.readline, ''):
                line = line.rstrip('\r\n')
                if line:
                    with self.lock:
                        self.logs.append(line)
            self.process.stdout.close()
            ret = self.process.wait()
            with self.lock:
                self.return_code = ret
                self.end_time = time.time()
                if self.status == "running":
                    self.status = "completed" if ret == 0 else "failed"
        except Exception as e:
            with self.lock:
                self.logs.append(f"[!] Log reader error: {str(e)}")
                self.status = "failed"

    def stop_scan(self):
        with self.lock:
            if not self.process or self.process.poll() is not None:
                return False, "No active scan to stop."

            try:
                self.process.terminate()
                # Wait briefly
                for _ in range(10):
                    if self.process.poll() is not None:
                        break
                    time.sleep(0.1)
                if self.process.poll() is None:
                    self.process.kill()

                self.status = "stopped"
                self.end_time = time.time()
                self.logs.append("[-] Scan stopped by user.")
                return True, "Scan successfully stopped."
            except Exception as e:
                return False, f"Error stopping scan: {str(e)}"

    def get_status(self, offset=0):
        with self.lock:
            new_logs = self.logs[offset:]
            return {
                "status": self.status,
                "target": self.target_name,
                "url": self.target_url,
                "start_time": self.start_time,
                "end_time": self.end_time,
                "elapsed": (time.time() - self.start_time) if self.start_time and self.status == "running" else (
                    (self.end_time - self.start_time) if self.start_time and self.end_time else 0
                ),
                "logs": new_logs,
                "total_log_count": len(self.logs)
            }


SCAN_MGR = ScanManager()


class PhotonRequestHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress noisy HTTP request stdout logs
        return

    def send_json(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, message, status=400):
        self.send_json({"error": message}, status=status)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == '/' or path == '/index.html':
            self.serve_file(os.path.join(WEB_DIR, 'index.html'), 'text/html; charset=utf-8')
        elif path == '/style.css':
            self.serve_file(os.path.join(WEB_DIR, 'style.css'), 'text/css; charset=utf-8')
        elif path == '/app.js':
            self.serve_file(os.path.join(WEB_DIR, 'app.js'), 'application/javascript; charset=utf-8')
        elif path == '/api/status':
            offset = int(query.get('offset', ['0'])[0])
            self.send_json(SCAN_MGR.get_status(offset=offset))
        elif path == '/api/scans':
            self.send_json(self.list_past_scans())
        elif path == '/api/results':
            target = query.get('target', [''])[0]
            if not target:
                self.send_error_json("Target parameter is required")
                return
            self.send_json(self.load_target_results(target))
        elif path == '/api/dns-image':
            target = query.get('target', [''])[0]
            img_path = os.path.join(BASE_DIR, target, f"{target}.png")
            if os.path.exists(img_path):
                self.serve_file(img_path, 'image/png')
            else:
                self.send_error_json("Image not found", status=404)
        else:
            self.send_error_json("Not Found", status=404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else b'{}'

        try:
            payload = json.loads(body.decode('utf-8')) if body else {}
        except Exception:
            payload = {}

        if path == '/api/scan':
            ok, result = SCAN_MGR.start_scan(payload)
            if ok:
                self.send_json(result)
            else:
                self.send_error_json(result)
        elif path == '/api/stop':
            ok, msg = SCAN_MGR.stop_scan()
            if ok:
                self.send_json({"message": msg})
            else:
                self.send_error_json(msg)
        else:
            self.send_error_json("Not Found", status=404)

    def serve_file(self, filepath, content_type):
        if not os.path.exists(filepath):
            self.send_error_json("File Not Found", status=404)
            return

        try:
            with open(filepath, 'rb') as f:
                data = f.read()
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self.send_error_json(f"Error reading file: {str(e)}", status=500)

    def list_past_scans(self):
        ignored = {'.git', 'core', 'plugins', 'web', 'venv', '__pycache__', '.system_generated'}
        scans = []
        for entry in os.listdir(BASE_DIR):
            full_path = os.path.join(BASE_DIR, entry)
            if os.path.isdir(full_path) and entry not in ignored and not entry.startswith('.'):
                # Check if it contains Photon output files
                txt_files = [f for f in os.listdir(full_path) if f.endswith('.txt') or f.endswith('.json')]
                if txt_files:
                    mtime = os.path.getmtime(full_path)
                    total_items = 0
                    for tf in txt_files:
                        if tf.endswith('.txt'):
                            try:
                                with open(os.path.join(full_path, tf), 'r', encoding='utf-8', errors='ignore') as f:
                                    total_items += sum(1 for line in f if line.strip())
                            except Exception:
                                pass
                    scans.append({
                        "name": entry,
                        "time": time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(mtime)),
                        "timestamp": mtime,
                        "count": total_items
                    })
        scans.sort(key=lambda s: s["timestamp"], reverse=True)
        return scans

    def load_target_results(self, target):
        # Sanitize target to avoid directory traversal
        target = os.path.basename(target)
        target_dir = os.path.join(BASE_DIR, target)
        if not os.path.isdir(target_dir):
            return {}

        categories = [
            'internal', 'fuzzable', 'endpoints', 'keys', 'intel',
            'scripts', 'files', 'subdomains', 'robots', 'custom', 'external'
        ]
        results = {cat: [] for cat in categories}

        for cat in categories:
            fpath = os.path.join(target_dir, f"{cat}.txt")
            if os.path.exists(fpath):
                try:
                    with open(fpath, 'r', encoding='utf-8', errors='ignore') as f:
                        lines = [line.strip() for line in f if line.strip()]
                        # Deduplicate while preserving order
                        seen = set()
                        deduped = []
                        for l in lines:
                            if l not in seen:
                                seen.add(l)
                                deduped.append(l)
                        results[cat] = deduped
                except Exception:
                    pass

        # Check for DNS map image
        img_path = os.path.join(target_dir, f"{target}.png")
        results['has_dns_map'] = os.path.exists(img_path)
        results['target'] = target

        return results


def find_available_port(start_port=5000, max_attempts=50):
    for p in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', p)) != 0:
                return p
    return start_port


def main():
    parser = argparse.ArgumentParser(description="Photon Web Dashboard Server")
    parser.add_argument('-p', '--port', type=int, default=5000, help="Port to run web server on (default: 5000)")
    parser.add_argument('-H', '--host', type=str, default="127.0.0.1", help="Host interface (default: 127.0.0.1)")
    args = parser.parse_args()

    port = find_available_port(args.port)
    server_address = (args.host, port)

    print("\n" + "=" * 55)
    print("   ____  __          __")
    print("  / __ \\/ /_  ____  / /_____  ____")
    print(" / /_/ / __ \\/ __ \\/ __/ __ \\/ __ \\")
    print("/ ____/ / / / /_/ / /_/ /_/ / / / /   WEB UI")
    print("/_/   /_/ /_/\\____/\\__/\\____/_/ /_/  v1.3.2")
    print("=" * 55)
    print(f"\n[+] Photon Web Interface running at: http://{args.host}:{port}")
    print(f"[+] Engine interpreter: {PYTHON_EXE}")
    print("[+] Press Ctrl+C to stop the web server.\n")

    httpd = ThreadingHTTPServer(server_address, PhotonRequestHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[-] Shutting down server...")
        SCAN_MGR.stop_scan()
        httpd.server_close()
        print("[+] Server stopped.")


if __name__ == '__main__':
    main()

