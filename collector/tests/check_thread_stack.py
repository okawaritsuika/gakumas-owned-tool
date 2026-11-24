"""Exercise DLL thread notifications without loading the game or IL2CPP."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def main():
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", type=Path, default=root / "work/thread_stack_host.exe")
    parser.add_argument("--dll", type=Path, default=root / "collector/build/version.dll")
    parser.add_argument("--expect-64k-overflow", action="store_true",
                        help="Confirm the old faulty DLL reproduces 0xc00000fd.")
    args = parser.parse_args()
    rows = []
    for reserve_kib in (128, 64):
        expected = (0xC00000FD if args.expect_64k_overflow and reserve_kib == 64 else 0)
        result = subprocess.run(
            [str(args.host.resolve()), str(args.dll.resolve()), str(reserve_kib)],
            capture_output=True, text=True, timeout=15,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        actual = result.returncode & 0xFFFFFFFF
        rows.append({"reserveKiB": reserve_kib, "exitCode": f"0x{actual:08x}",
                     "expectedExitCode": f"0x{expected:08x}",
                     "passed": actual == expected,
                     "stdout": result.stdout, "stderr": result.stderr})
    passed = all(row["passed"] for row in rows)
    print(json.dumps({"passed": passed,
                      "dllSha256": hashlib.sha256(args.dll.read_bytes()).hexdigest(),
                      "cases": rows}, ensure_ascii=False, indent=2))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
