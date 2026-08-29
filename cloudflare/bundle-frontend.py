#!/usr/bin/env python3
"""Generate frontend-bundle.js from frontend source files."""

import base64
import json
from pathlib import Path

FRONTEND_DIR = Path(__file__).parent / "frontend-src"
OUTPUT_FILE = Path(__file__).parent / "frontend-bundle.js"

# Files to bundle
FILES = [
    "index.html",
    "css/style.css",
    "js/app.js",
    "js/i18n.js",
    "js/icons.js",
    "js/disclaimer.js",
]

CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
}

def get_content_type(pathname):
    ext = Path(pathname).suffix
    return CONTENT_TYPES.get(ext, 'application/octet-stream')

def main():
    files = {}
    for rel_path in FILES:
        full_path = FRONTEND_DIR / rel_path
        if full_path.exists():
            content = full_path.read_bytes()
            files[rel_path] = base64.b64encode(content).decode('ascii')
        else:
            print(f"WARNING: {full_path} not found")

    output = f"""const FRONTEND_FILES = {json.dumps(files, ensure_ascii=False, indent=2)};

export function getFrontendFile(pathname) {{
  const b64 = FRONTEND_FILES[pathname];
  if (!b64) return null;
  // Properly decode UTF-8 content stored as base64
  const bytes = new Uint8Array(atob(b64).split('').map(c => c.charCodeAt(0)));
  return new TextDecoder('utf-8').decode(bytes);
}}

export function getContentType(pathname) {{
  const ext = pathname.split('.').pop();
  const types = {{
    'html': 'text/html; charset=utf-8',
    'js': 'application/javascript; charset=utf-8',
    'css': 'text/css; charset=utf-8',
    'json': 'application/json',
  }};
  return types[ext] || 'application/octet-stream';
}}

export {{ FRONTEND_FILES }};
"""
    OUTPUT_FILE.write_text(output, encoding='utf-8')
    print(f"Bundle created: {OUTPUT_FILE}")
    print(f"Files bundled: {len(files)}")

if __name__ == "__main__":
    main()
