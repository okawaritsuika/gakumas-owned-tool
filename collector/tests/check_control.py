"""Verify explicit off/on/off control only in disposable synthetic hosts."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

from check_fixture import SEED, expect_snapshot

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / 'collector/tests/build'
DLL = ROOT / 'collector/build/version.dll'


def prepare(run_root, name):
    case = run_root / name
    case.mkdir()
    for filename in ('gakumas.exe', 'GameAssembly.dll', 'VuplexWebViewWindows.dll'):
        shutil.copy2(FIXTURES / filename, case / filename)
    shutil.copy2(DLL, case / 'version.dll')
    shutil.copy2(Path(os.environ['SystemRoot']) / 'System32/version.dll', case / 'gakumas_inventory_system_version.dll')
    config = case / 'gakumas-inventory'
    config.mkdir()
    output = case / 'inventory.json'
    output.write_bytes(SEED)
    control = case / 'collector-control.json'
    (config / 'collector.ini').write_text(
        f'[collector]\noutput={output}\ncontrol={control}\ninterval_seconds=2\n', encoding='utf-16')
    return case, output, control


def write_control(path, enabled, lifetime=30000):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps({'schemaVersion': 1, 'enabled': enabled,
                              'expiresAtUnixMs': int(time.time() * 1000) + lifetime if enabled else 0}), encoding='utf-8')
    os.replace(temp, path)


def status_of(output):
    return json.loads(Path(str(output) + '.status.json').read_text(encoding='utf-8'))


def dynamic(run_root):
    case, output, control = prepare(run_root, 'off_on_expire_on_off')
    process = subprocess.Popen([str(case / 'gakumas.exe'), '0', '13', 'metrics_shutdown'], cwd=case,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                               creationflags=subprocess.CREATE_NO_WINDOW)
    metrics, checkpoints, sent = [], {}, set()
    previous_snapshot = None
    for line in process.stdout:
        row = json.loads(line)
        metrics.append(row)
        elapsed = row.get('elapsedMs')
        if elapsed is None:
            continue
        if elapsed >= 1250 and 'off' not in sent:
            assert row['domainCalls'] == row['attached'] == row['active'] == 0, row
            assert output.read_bytes() == SEED
            status = status_of(output)
            assert status['state'] == 'paused' and status['samplingEnabled'] is False, status
            assert status['moduleVersion'] == '0.1.3' and status['controlSupported'] is True
            checkpoints['defaultOff'] = row
            write_control(control, True, 3500)
            sent.add('off')
        if elapsed >= 5500 and 'expired' not in sent:
            expect_snapshot(output)
            assert row['active'] == 0 and row['attached'] == row['detached'] >= 2, row
            assert status_of(output)['state'] == 'paused'
            checkpoints['expired'] = row
            previous_snapshot = output.read_bytes()
            sent.add('expired')
        if elapsed >= 6750 and 'restarted' not in sent:
            assert row['domainCalls'] == checkpoints['expired']['domainCalls'], row
            assert row['attached'] == checkpoints['expired']['attached'], row
            assert output.read_bytes() == previous_snapshot
            write_control(control, True)
            sent.add('restarted')
        if elapsed >= 10000 and 'stopped' not in sent:
            expect_snapshot(output)
            assert row['attached'] >= checkpoints['expired']['attached'] + 2, row
            write_control(control, False)
            sent.add('stopped')
        if elapsed >= 11000 and 'stoppedChecked' not in sent:
            assert status_of(output)['state'] == 'paused'
            assert row['active'] == 0 and row['attached'] == row['detached'], row
            checkpoints['explicitOff'] = row
            previous_snapshot = output.read_bytes()
            sent.add('stoppedChecked')
        if elapsed >= 12000:
            assert row['domainCalls'] == checkpoints['explicitOff']['domainCalls'], row
            assert row['attached'] == checkpoints['explicitOff']['attached'], row
            assert output.read_bytes() == previous_snapshot
    stderr = process.communicate(timeout=5)[1]
    assert process.returncode == 0, (process.returncode, stderr, metrics)
    assert len(checkpoints) == 3
    assert metrics[-1]['lateAttach'] == metrics[-1]['unattachedMetadataReads'] == 0
    return {'case': case.name, 'passed': True, 'checkpoints': checkpoints, 'shutdown': metrics[-1], 'metrics': metrics}


def stop_inflight(run_root, cancel=False):
    case, output, control = prepare(run_root, 'cancel_during_second_read' if cancel else 'disable_during_second_read')
    write_control(control, True)
    process = subprocess.Popen([str(case / 'gakumas.exe'), '12', '7', 'metrics_shutdown'], cwd=case,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                               creationflags=subprocess.CREATE_NO_WINDOW)
    stopped = None
    metrics = []
    for line in process.stdout:
        row = json.loads(line)
        metrics.append(row)
        if not stopped and row.get('active') == 1 and row.get('attached') == 2:
            if cancel:
                Path(str(control) + '.cancel').write_text('{}', encoding='utf-8')
                # Simulate a stale heartbeat arriving after the stop request.
                write_control(control, True)
            else:
                write_control(control, False)
            stopped = row
    stderr = process.communicate(timeout=5)[1]
    assert process.returncode == 0, (process.returncode, stderr, metrics)
    assert stopped, metrics
    assert output.read_bytes() == SEED, 'in-flight capture published after off'
    assert status_of(output)['state'] == 'paused'
    assert metrics[-1]['attached'] == metrics[-1]['detached'] == 2
    return {'case': case.name, 'passed': True, 'disabledDuring': stopped, 'shutdown': metrics[-1]}


def invalid_control(run_root, name, content):
    case, output, control = prepare(run_root, name)
    if content is not None:
        control.write_text(content, encoding='utf-8')
    if name == 'cancel_overrides_new_enabled_lease':
        Path(str(control) + '.cancel').write_text('{}', encoding='utf-8')
    run = subprocess.run([str(case / 'gakumas.exe'), '0', '3', 'metrics'], cwd=case,
                         capture_output=True, text=True, timeout=8, creationflags=subprocess.CREATE_NO_WINDOW)
    assert run.returncode == 0, (name, run.returncode, run.stderr)
    metrics = [json.loads(line) for line in run.stdout.splitlines()]
    assert all(row['attached'] == row['domainCalls'] == row['active'] == 0 for row in metrics), (name, metrics)
    assert output.read_bytes() == SEED
    assert status_of(output)['state'] == 'paused'
    return {'case': name, 'passed': True, 'domainCalls': 0, 'attached': 0}


def main():
    work = ROOT / 'work/collector-fixtures'
    work.mkdir(exist_ok=True, parents=True)
    run_root = Path(tempfile.mkdtemp(prefix='control-', dir=work))
    future = int(time.time() * 1000) + 30000
    malformed = {
        'missing': None,
        'false': json.dumps({'schemaVersion': 1, 'enabled': False, 'expiresAtUnixMs': future}),
        'expired': '{"schemaVersion":1,"enabled":true,"expiresAtUnixMs":1}',
        'too_long': json.dumps({'schemaVersion': 1, 'enabled': True, 'expiresAtUnixMs': future + 3600000}),
        'torn': '{"schemaVersion":1,"enabled":true,',
        'string_true': f'{{"schemaVersion":1,"enabled":"true","expiresAtUnixMs":{future}}}',
        'duplicate': f'{{"schemaVersion":1,"enabled":false,"enabled":true,"expiresAtUnixMs":{future}}}',
        'unknown_field': f'{{"schemaVersion":1,"enabled":true,"expiresAtUnixMs":{future},"other":1}}',
        'wrong_schema': f'{{"schemaVersion":2,"enabled":true,"expiresAtUnixMs":{future}}}',
        'trailing_data': f'{{"schemaVersion":1,"enabled":true,"expiresAtUnixMs":{future}}}true',
        'cancel_overrides_new_enabled_lease': json.dumps({'schemaVersion': 1, 'enabled': True, 'expiresAtUnixMs': future}),
    }
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        invalid = list(pool.map(lambda item: invalid_control(run_root, *item), malformed.items()))
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(dynamic, run_root), pool.submit(stop_inflight, run_root), pool.submit(stop_inflight, run_root, True)]
        rows = [*invalid, *(future.result() for future in futures)]
    report = {'scope': 'Synthetic runtime only; no actual game/process access or installed DLL changes.',
              'moduleVersion': '0.1.3', 'collectorSha256': hashlib.sha256(DLL.read_bytes()).hexdigest(),
              'runDirectory': str(run_root), 'passed': True, 'cases': rows}
    (run_root / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'passed': True, 'cases': len(rows), 'report': str(run_root / 'report.json')}))


if __name__ == '__main__':
    main()
