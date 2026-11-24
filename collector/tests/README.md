# Offline native collector fixture

These are synthetic files, not game binaries. Never copy the fake
`GameAssembly.dll` or fake `gakumas.exe` into the real game directory.
No account or live process is read by this fixture.

Build from an x64 Visual Studio Developer Command Prompt after creating
`collector\tests\build`:

```text
cl /nologo /LD /std:c11 /MT /O2 /W4 collector\tests\fake_gameassembly.c /Focollector\tests\build\fake_gameassembly.obj /link /OUT:collector\tests\build\GameAssembly.dll /IMPLIB:collector\tests\build\fake_gameassembly.lib
cl /nologo /LD /std:c11 /MT /O2 /W4 collector\tests\fake_vuplex.c /Focollector\tests\build\fake_vuplex.obj /link /OUT:collector\tests\build\VuplexWebViewWindows.dll
cl /nologo /std:c11 /MT /O2 /W4 collector\tests\fake_gakumas.c /Focollector\tests\build\fake_gakumas.obj /link /OUT:collector\tests\build\gakumas.exe
```

`fake_gameassembly.c` exports the exact 26 APIs in `../il2cpp_api.h`, plus a
test-only `fixture_set_mode` function. The fake host loads that DLL, configures
the synthetic scenario, loads the Vuplex readiness stub and the actual collector
DLL, then exits after 15 seconds by default. Its optional arguments are numeric
mode and lifetime in seconds. Only this deliberately named test host starts the
collector worker; it does not launch or attach to the real game.

Run the contract assertions with Python 3.9 or later:

```text
python collector\tests\check_fixture.py
```

The checker creates a fresh folder beneath `work/collector-fixtures`, copies the
test builds and collector there, and writes UTF-16 configuration pointing to that
folder. It copies this PC's original `System32/version.dll` to the required
forwarder companion name. It runs the twelve hosts without visible windows and
retains their JSON/logs plus `report.json` for inspection. It refuses a work
directory outside the project's `work/`. No broad process termination or cleanup
is performed. Each test host normally exits itself; a timeout concerns only that
host created by the checker.

Since 0.1.3, the correctness/lifecycle checkers explicitly create a short-lived
enabled control JSON beside each synthetic snapshot. No test relies on default
collection. The control regression is:

```text
python collector\tests\check_control.py
```

It checks missing/disabled/invalid/expired/cancelled requests have zero domain API
calls and zero runtime attachments, with the previous snapshot unchanged. A
single host then goes off → on → lease expiry → on → explicit off without a
process restart. Another host disables collection during its second bounded
read and verifies that no snapshot is published after that switch. A separate
in-flight cancellation case writes a fresh enabled lease after the stop marker,
and verifies that the persistent cancellation still prevents publication. Both check
balanced detach counts and synthetic shutdown. These tests use isolated fake
hosts only and cannot prove that every real Unity shutdown call is bounded.

`node collector/tests/check_scripts.mjs` runs copied entry scripts against a
private HTTP stub. It checks normal/collect/stop, failed collect HTTP requests,
persistent cancellation despite a stale renewal, installation-record snapshot
paths, and environment overrides. This test never opens a browser or operates
the actual game/app server.

The scenarios are:

| Mode | Purpose |
|---|---|
| 0 | Two owned supports, one P-idol, one character and one nested memory. Old signed-hash dictionaries contain a deleted slot; newer unsigned-hash dictionaries contain a free-next slot. A valid unsigned hash is `0xffffffff` to catch accidental signed interpretation. |
| 1 | Singleton unavailable. Latest attempt remains waiting and a pre-existing snapshot stays byte-for-byte unchanged. |
| 2 | A required support field is absent. No incomplete ownership list replaces the prior snapshot. |
| 3 | Memory dictionary version changes during traversal. This test-only fault injection exercises the collector's actual consistency check. |
| 4 | Legitimately empty owned memory list with ready P-idol data. All four collections can still be complete. |
| 5 | Empty P-idol data before normal login. It must remain waiting instead of publishing an empty ownership result. |
| 6 | Exact UniRx.ReactiveDictionary and System.Collections.ObjectModel.ReadOnlyDictionary wrappers, including both two-wrapper orders, produce the same expected inventory. |
| 7 | A wrapper swaps its inner object during traversal. The prior good snapshot must survive. |
| 8 | A different namespace reuses the ReactiveDictionary name. It is rejected and only its class/field metadata names are diagnosed. |
| 9 | Optional growth-panel state has an enabled level-2 node and a disabled level-3 node behind a ReactiveDictionary. Both are exported only after matching samples. |
| 10 | An optional growth-panel record lacks enable. The four primary lists still publish a complete snapshot; optional data is null with its own error. |
| 11 | Optional growth-panel levels change between samples. Primary data still publishes, while optional data stays null/waiting until two samples match. |

The positive assertion checks current level 25 and uncap 2, enum fields, character
True End values, two customized skill options, memory abilities and levels,
Vo/Da/Vi/stamina, phase, upgraded cards, exam items, Korean UTF-16 IDs, and the
64-bit timestamp `9007199254740993` remaining an exact decimal string.

Synthetic object structs deliberately include unrelated padding before their
data. Field offsets are generated with `offsetof`, and dictionary Entry fields
use boxed offsets with different unboxed value positions. The collector must
follow runtime metadata rather than rely on copied fixed game offsets.

Use repeated `--case` arguments to select cases, for example
`--case normal --case wrapped --case changing_wrapper --case unsupported_container`.
The normal/direct and wrapped cases also verify that an unavailable optional
growth-panel root stays null without preventing the four primary lists from
being published. Optional capture status is separate from those four statuses.

This test covers JSON and collection traversal in a controlled native runtime.
It cannot establish that the current game's runtime, collections or startup
behavior match those assumptions. A successful real capture and comparison with
the game's displayed inventory remain separate checks.

The lifecycle regression is separate from inventory correctness:

```text
python collector\tests\check_lifecycle.py
```

It runs four isolated hosts: normal capture, unavailable login manager, missing
required metadata, and failed file publication. The synthetic runtime counts
attachments/detachments, checks representative metadata reads are attached, then
marks its domain unavailable and rejects new attachments. Each host waits for
attached readers for at most one second outside DllMain and exits itself. The
collector must already be detached while idle, have balanced counts after at
least two polls, and make no new attachments after domain disappearance. This
models a shutdown waiting for registered readers; it does not prove the actual
game's shutdown implementation or establish the cause of a live hang.

For a preserved old DLL, `--collector path\to\old.dll
--expect-persistent-attachment` verifies that the original lifetime attachment
fails this synthetic shutdown condition with exit code 31. The test never kills
or inspects another game process. Reports and all fixture DLL copies stay under
the project's `work/collector-fixtures` directory.

The small-stack regression uses a separate non-game host. It loads the collector
without starting its worker, then creates threads with 128 KiB and 64 KiB reserved
stacks. This exercises DLL thread attach/detach notifications without loading the
game, GameAssembly or the fake runtime. Both must exit successfully. The previous
automatic 64 KiB path buffer in DllMain overflowed the smaller thread's stack
before checking the notification reason; that buffer now has static storage.

From the project root in an x64 MSVC developer prompt:

```bat
cl /nologo /O2 /MT /W3 /utf-8 collector\tests\thread_stack_host.c /Fework\thread_stack_host.exe /Fowork\thread_stack_host.obj
python collector\tests\check_thread_stack.py
```

For a preserved faulty DLL, `--dll path\to\old.dll --expect-64k-overflow` verifies
the original `0xc00000fd` reproduction. The checker prints the DLL hash and each
exit code as JSON. It does not inspect or control any other process.
