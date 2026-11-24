"""Check attached-reader shutdown in isolated synthetic hosts, never the game."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time


def main():
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collector", type=Path, default=root / "collector/build/version.dll")
    parser.add_argument("--expect-persistent-attachment", action="store_true")
    args = parser.parse_args()
    work = root / "work/collector-fixtures"
    work.mkdir(parents=True, exist_ok=True)
    run_root = Path(tempfile.mkdtemp(prefix="lifecycle-", dir=work))
    fixtures = root / "collector/tests/build"
    rows = []
    cases = [("normal", 0), ("waiting_login", 1), ("missing_field", 2), ("output_failure", 0)]
    if args.expect_persistent_attachment:
        cases = cases[:1]
    for name, mode in cases:
        case = run_root / name
        case.mkdir()
        for filename in ("gakumas.exe", "GameAssembly.dll", "VuplexWebViewWindows.dll"):
            shutil.copy2(fixtures / filename, case / filename)
        shutil.copy2(args.collector, case / "version.dll")
        shutil.copy2(Path(os.environ["SystemRoot"]) / "System32/version.dll", case / "gakumas_inventory_system_version.dll")
        config = case / "gakumas-inventory"
        config.mkdir()
        output = case / "inventory.json"
        if name == "output_failure":
            # This absent parent makes publication fail without changing the
            # metadata capture or creating a game-like runtime failure.
            output = case / "absent-parent/inventory.json"
        (config / "collector.ini").write_text(
            f"[collector]\noutput={output}\ncontrol={case / 'collector-control.json'}\ninterval_seconds=2\n", encoding="utf-16"
        )
        (case / "collector-control.json").write_text(json.dumps({"schemaVersion": 1, "enabled": True,
            "expiresAtUnixMs": int(time.time() * 1000) + 30000}), encoding="utf-8")
        run = subprocess.run([str(case / "gakumas.exe"), str(mode), "3", "shutdown"],
                             cwd=case, capture_output=True, text=True, timeout=12,
                             creationflags=subprocess.CREATE_NO_WINDOW)
        metrics = json.loads(run.stdout)
        if args.expect_persistent_attachment:
            assert run.returncode == 31, (run.returncode, metrics, run.stderr)
            assert metrics["active"] == 1 and metrics["detached"] == 0, metrics
        else:
            assert run.returncode == 0, (name, run.returncode, metrics, run.stderr)
            assert metrics["active"] == metrics["lateAttach"] == metrics["unattachedMetadataReads"] == 0, metrics
            assert metrics["attached"] == metrics["detached"] >= 2, metrics
        if name == "output_failure":
            assert not output.exists()
            assert "output_open_failed" in (config / "collector.log").read_text(encoding="utf-8")
        else:
            status = json.loads(Path(str(output) + ".status.json").read_text(encoding="utf-8"))
            assert status["state"] == {"normal": "complete", "waiting_login": "waiting", "missing_field": "partial"}[name], status
        rows.append({"case": name, "passed": True, "exitCode": run.returncode, **metrics})
    report = {"scope": "Synthetic runtime registration/shutdown only; no actual game, account, or live-process access.",
              "actualGameShutdownCauseConfirmed": False,
              "expectedPersistentAttachment": args.expect_persistent_attachment,
              "collectorSha256": hashlib.sha256(args.collector.read_bytes()).hexdigest(),
              "runDirectory": str(run_root), "cases": rows}
    (run_root / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
