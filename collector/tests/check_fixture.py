"""Run only isolated synthetic hosts; never inspect or alter a real game process."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time


SEED = b'{"fixture":"previous-good-snapshot"}\n'
COUNTS = {
    "userSupportCardList": 2,
    "userIdolCardList": 1,
    "userCharacterList": 1,
    "userMemoryList": 1,
}
CASES = [
    ("normal", 0, "complete"),
    ("waiting", 1, "waiting"),
    ("missing_field", 2, "partial"),
    ("changing", 3, "partial"),
    ("empty_memory", 4, "complete"),
    ("prelogin_empty_idol", 5, "waiting"),
    ("wrapped", 6, "complete"),
    ("changing_wrapper", 7, "partial"),
    ("unsupported_container", 8, "partial"),
    ("optional_normal", 9, "complete"),
    ("optional_missing_field", 10, "complete"),
    ("optional_changing", 11, "complete"),
]


def expect_snapshot(path: Path, empty_memory: bool = False) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["schemaVersion"] == 1
    assert data["source"] == "gakumas-local-collector"
    assert data["capture"]["status"] == "complete"
    assert data["capturedAt"].endswith("Z")
    assert data["producerLevel"] is None
    expected_counts = {**COUNTS, "userMemoryList": 0 if empty_memory else 1}
    assert set(data["capture"]["collections"]) == set(COUNTS)
    for name, count in expected_counts.items():
        status = data["capture"]["collections"][name]
        assert status["status"] == "complete", (name, status)
        assert status["expectedCount"] == count, (name, status)
        assert status["exportedCount"] == count, (name, status)
        assert len(data[name]) == count
    support = {row["supportCardId"]: row for row in data["userSupportCardList"]}
    assert support["support-fixture-001"] == {
        "supportCardId": "support-fixture-001", "level": 25,
        "levelLimitRank": 2, "stockQuantity": 3,
    }
    assert support["support-fixture-002"]["level"] == 40
    assert data["userIdolCardList"] == [{
        "idolCardId": "p-idol-fixture-001", "levelLimitRank": 2,
        "potentialRank": 4, "primaStellaUpgradedTime": "9007199254740993",
    }]
    assert data["userCharacterList"] == [{
        "characterId": "character-fixture-001", "dearnessPoint": 6240,
        "trueEndProduceTypes": [1, 3],
    }]
    if empty_memory:
        return
    memory = data["userMemoryList"][0]
    assert memory["userMemoryId"] == "memory-메모리-001"
    assert memory["produceId"] == "produce-fixture-hif"
    assert memory["idolCardId"] == "p-idol-fixture-001"
    assert memory["characterId"] == "character-fixture-001"
    assert (memory["planType"], memory["produceCardPhaseType"]) == (3, 2)
    assert (memory["vocal"], memory["dance"], memory["visual"], memory["stamina"]) == (1501, 2602, 1703, 35)
    assert memory["isPrimaStella"] is True
    assert memory["produceCard"] == {
        "id": "skill-fixture-001", "upgradeCount": 1,
        "customizes": [
            {"id": "customize-fixture-a", "customizeCount": 1},
            {"id": "customize-fixture-b", "customizeCount": 2},
        ],
    }
    assert memory["abilities"] == [
        {"id": "ability-fixture-001", "level": 4},
        {"id": "ability-fixture-002", "level": 2},
    ]
    assert memory["examBattleProduceCards"][0] == memory["produceCard"]
    assert memory["examBattleProduceCards"][1] == {"id": "skill-fixture-002", "upgradeCount": 0, "customizes": []}
    assert memory["examBattleProduceItemIds"] == ["item-fixture-a", "item-한글"]


def main() -> None:
    project = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collector", type=Path, default=project / "collector/build/version.dll")
    parser.add_argument("--fixtures", type=Path, default=project / "collector/tests/build")
    parser.add_argument("--work-dir", type=Path, default=project / "work/collector-fixtures")
    parser.add_argument("--seconds", type=int, default=6)
    parser.add_argument("--case", action="append", choices=[case[0] for case in CASES],
                        help="Run only named cases; may be repeated.")
    args = parser.parse_args()
    if os.name != "nt":
        parser.error("The offline native fixture requires Windows.")
    if not 4 <= args.seconds <= 15:
        parser.error("--seconds must be 4–15.")
    work = args.work_dir.resolve()
    if not work.is_relative_to((project / "work").resolve()):
        parser.error("--work-dir must stay inside this project's work/ folder.")
    work.mkdir(parents=True, exist_ok=True)
    run_root = Path(tempfile.mkdtemp(prefix="offline-", dir=work))
    collector = args.collector.resolve()
    fixtures = args.fixtures.resolve()
    for file in [collector, *(fixtures / name for name in ("gakumas.exe", "GameAssembly.dll", "VuplexWebViewWindows.dll"))]:
        if not file.is_file() or not file.stat().st_size:
            parser.error(f"Missing or empty build artifact: {file}")
    system_version = Path(os.environ["SystemRoot"]) / "System32/version.dll"
    cases = [case for case in CASES if not args.case or case[0] in args.case]
    results = []
    for name, mode, expected_state in cases:
        case = run_root / name
        case.mkdir()
        for filename in ("gakumas.exe", "GameAssembly.dll", "VuplexWebViewWindows.dll"):
            shutil.copy2(fixtures / filename, case / filename)
        shutil.copy2(collector, case / "version.dll")
        # Use only this PC's original OS DLL, inside this disposable test folder.
        shutil.copy2(system_version, case / "gakumas_inventory_system_version.dll")
        config = case / "gakumas-inventory"
        config.mkdir()
        output = case / "inventory.json"
        if expected_state != "complete":
            output.write_bytes(SEED)
        (config / "collector.ini").write_text(
            f"[collector]\noutput={output}\ninterval_seconds=2\n", encoding="utf-16"
        )
        (case / "collector-control.json").write_text(json.dumps({"schemaVersion": 1, "enabled": True,
            "expiresAtUnixMs": int(time.time() * 1000) + 30000}), encoding="utf-8")
        run = subprocess.run(
            [str(case / "gakumas.exe"), str(mode), str(args.seconds)], cwd=case,
            capture_output=True, timeout=args.seconds + 8,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        assert run.returncode == 0, (name, run.returncode, run.stderr.decode(errors="replace"))
        status_file = Path(str(output) + ".status.json")
        assert status_file.is_file(), (name, "status file missing")
        status = json.loads(status_file.read_text(encoding="utf-8"))
        assert status["state"] == expected_state, (name, status)
        if expected_state == "complete":
            expect_snapshot(output, empty_memory=name == "empty_memory")
            snapshot = json.loads(output.read_text(encoding="utf-8"))
            optional = snapshot["growthPanelCapture"]
            if name == "optional_normal":
                assert optional["status"] == "complete", optional
                assert optional["expectedCount"] == optional["exportedCount"] == 2
                assert snapshot["userProduceGrowthPanelList"] == [
                    {"produceGrowthPanelId": "growth-panel-fixture-active", "level": 2, "enable": True},
                    {"produceGrowthPanelId": "growth-panel-fixture-disabled", "level": 3, "enable": False},
                ]
            else:
                assert snapshot["userProduceGrowthPanelList"] is None
                if name == "optional_missing_field":
                    assert optional["status"] == "error"
                    assert optional["message"] == "required_field_missing:enable", optional
                elif name == "optional_changing":
                    assert optional["status"] == "waiting"
                    assert optional["message"] == "waiting_for_second_matching_snapshot", optional
                else:
                    assert optional["status"] == "error"
                    assert optional["expectedCount"] is None
        else:
            assert output.read_bytes() == SEED, (name, "last good snapshot changed")
        if name == "missing_field":
            assert status["capture"]["collections"]["userSupportCardList"]["status"] != "complete"
        elif name == "changing":
            assert status["capture"]["collections"]["userMemoryList"]["status"] != "complete"
        elif name == "changing_wrapper":
            assert status["capture"]["collections"]["userMemoryList"]["message"] == "owned_wrapper_replaced_during_read"
        elif name == "unsupported_container":
            assert status["capture"]["collections"]["userMemoryList"]["message"] == "unsupported_owned_container:Fixture.ReactiveDictionary`2"
            log = (config / "collector.log").read_text(encoding="utf-8")
            assert "class=Fixture.ReactiveDictionary`2" in log
            assert "field=inner" in log
        results.append({"case": name, "passed": True, "state": status["state"], "stage": status["stage"]})
    report = {
        "scope": "Offline synthetic native runtime only; no actual game/account access or compatibility claim.",
        "runDirectory": str(run_root), "cases": results,
    }
    (run_root / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
