"""Cross-platform .env process loader; no shell evaluation or secret output."""
import os
import re
import subprocess
import sys
from pathlib import Path

environment = os.environ.copy()
path = Path('.env')
if path.exists():
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        match = re.fullmatch(r'([A-Za-z_][A-Za-z0-9_]*)=(.*)', line)
        if match is None:
            raise ValueError('Invalid environment assignment')
        name, value = match.groups()
        if name.upper() in {'HOME', 'CODEX_HOME', 'PATH', 'COMSPEC', 'PSMODULEPATH'}:
            raise ValueError('Reserved environment name')
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        environment[name] = value
arguments = sys.argv[1:] or ['run', '--project', 'src/ModularBackend.Api', '--no-launch-profile']
sys.exit(subprocess.run(['dotnet', *arguments], env=environment, check=False).returncode)
