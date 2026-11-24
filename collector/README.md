# Local inventory collector 0.1.3

This Windows x64 C DLL supplies inventory JSON to the local recommendation app.
It contains no localization code, cosmetic unlocks, managed method hooks,
network client, credential reader, gameplay automation, or game-state setters.
Only a process named `gakumas.exe` starts its worker; other hosts can test the
ordinary Windows version-API forwarders without starting collection.

## Build and installation boundary

The source builds with Visual Studio 2019 or later and a Windows SDK. From the
project root, use the working build scripts:

```text
python work\build_collector.py
work\build_collector.cmd
```

The Python script reads this PC's `System32\version.dll` exports and generates
`collector\version_forwarders.c`, containing linker pragmas that forward each
name and ordinal to `gakumas_inventory_system_version`. For example:

```text
#pragma comment(linker, "/export:GetFileVersionInfoW=gakumas_inventory_system_version.GetFileVersionInfoW,@9")
```

The batch script initializes the available x64 MSVC tools and compiles
`collector.c` together with `version_forwarders.c` using `/LD /MT /O2 /std:c11`.
It writes `collector\build\version.dll`. The generated `version.def` is retained
as a readable export manifest; it is **not passed to `/DEF`**. That approach
produced unresolved-symbol errors with the tested MSVC 2019 linker, while the
pragma-based build passed the forwarding smoke test.

The installer copies the local PC's original OS DLL to the game directory as
`gakumas_inventory_system_version.dll`. Do not bundle another PC's Windows DLL.
Source/build work alone does not install either DLL into the game. Do not
overwrite an existing translation or other `version.dll`; the installer must
inspect that situation. The installer refuses installation while the game is
running. Stop the game before installing, replacing or removing collector files.

The `/MT` build preserves CRT thread attach/detach notifications. DllMain starts
the worker and returns without waiting; runtime discovery and file work happen
in that worker after loader initialization.

The worker attaches to IL2CPP separately for each bounded inventory read and
detaches before publishing snapshots/status or sleeping. The login-waiting and read-error
paths also detach before waiting. After the initially observed runtime module or
domain disappears, it stops attempting new reads. A non-null domain is not a
complete runtime-shutdown signal, so this reduces attachment lifetime without
claiming to detect every Unity shutdown race.
The existing bounded, once-per-class metadata diagnostic log can still write
during an attached read. Exception guards handle access faults, not arbitrary
runtime-call hangs; this patch does not claim to cure every possible exit hang.

`DLL_PROCESS_DETACH` only sets the atomic stop flag. It never waits for a worker,
calls the runtime, closes shared handles or writes files while the loader lock
is held. At process exit, Windows may already have terminated other threads;
normal worker cleanup must happen before that notification. Do not dynamically
unload this proxy beneath its worker; replace it only with the game fully closed.
These changes do not hook the game's exit path or force any process/thread to end.

## Configuration

The worker reads an adjacent `gakumas-inventory\collector.ini`:

```ini
[collector]
output=C:\absolute\project\app\data\inventory.json
interval_seconds=10
control=C:\absolute\project\app\data\collector-control.json
```

Write this INI as **UTF-16LE with a BOM**, because it is read with the Unicode
Windows profile API and the project path can contain Korean characters. Output
must be a local absolute drive path. The parent installer creates its directory.
If the INI is missing, the output fallback is the game-adjacent
`gakumas-inventory\inventory.json`. The control default is `collector-control.json`
beside the output. The interval is clamped to 2–300 seconds.

Collection is **off by default**, including with missing/invalid configuration.
The app writes the following UTF-8 JSON by atomic replacement:

```json
{"schemaVersion":1,"enabled":true,"expiresAtUnixMs":1793740000000}
```

`expiresAtUnixMs` must be an integer Unix timestamp in milliseconds, after now
and at most 60 seconds ahead. The server renews a requested collection session
every 10 seconds with a 30-second expiry. Normal startup, normal-mode selection,
installation and app shutdown write `enabled:false` with expiry 0. A server crash
stops renewal, so collection stops within the remaining lease (at most 30 seconds
for the app's requests). A short still-valid lease can survive an abrupt crash;
this is not an immediate crash detector. Unknown keys, duplicate keys, string
booleans, malformed files and stale leases all mean off.

`collector-control.json.cancel` is a persistent stop marker. Its existence (or
an inability to check it safely) overrides every enabled lease. Normal/stop
scripts atomically create this marker **before** writing disabled control; a
stale server heartbeat cannot erase the stop request by replacing the JSON.
Only a new explicit collect request may remove the marker. The status field
`samplingEnabled` also rechecks the effective gate when the status is published.

The scripts resolve the snapshot from `GAKUMAS_SNAPSHOT`, then the installation
record's `snapshotPath`, then `app/data/inventory.json`. Control and cancellation
files always live beside that resolved snapshot. The start script passes the
same resolved snapshot to the child Node process. An explicit installer
`-SnapshotPath` also places control beside that file and records the path.

While off, the worker only checks the local control/cancel files and stop flag; it does
not call IL2CPP, discover its domain, attach a runtime thread or sample inventory.
It writes `state:paused` only when entering that mode, preserving the last complete
inventory. Changing the file takes effect without restarting the game: idle
checks take at most one second, and active polling sleep checks every 250 ms.
A bounded read already in progress finishes and detaches; the worker checks the
gate again before publication and discards that attempt if collection is now off.
This does not interrupt or force-stop a runtime call that is already blocked.

`시작.cmd` selects normal mode and reads saved ownership. `수집 모드로 시작.cmd`
explicitly requests collection; the server normally returns to normal mode after
one fresh complete snapshot. Existing 0.1.2 DLLs do not support this gate. They
require installation of 0.1.3 with the game fully closed, followed by a game
restart; changing the JSON alone cannot disable an already loaded 0.1.2 worker.

Output files are UTF-8:

* `inventory.json`: only the latest complete, stable four-collection snapshot.
* `inventory.json.status.json`: latest attempt's `state`, `stage`, `message`,
  UTC time, and collection counts. Waiting/error/partial attempts preserve the
  last good inventory file. Version 0.1.3 also reports `moduleVersion`,
  `collectorVersion`, `controlSupported:true` and `samplingEnabled`.
* Game-adjacent `gakumas-inventory\collector.log`: bounded diagnostic log with
  stages, constant error codes and field names; no account IDs, profile,
  command line, headers, tokens or card contents are logged.

Temporary output is replaced atomically in the destination directory.

## Runtime behavior

1. First require an explicit, unexpired collection lease and no cancellation
   marker. While disabled, only poll those local files; do not call IL2CPP.
   Once enabled, wait for both `GameAssembly.dll` and `VuplexWebViewWindows.dll`, the readiness
   point observed in the existing Localify source. No load-library hook is used.
2. Resolve only the read-only runtime exports listed in `il2cpp_api.h`. Before
   calling any of them, require executable mapped memory and nonzero code bytes.
   Missing/packed/not-yet-ready exports remain a diagnostic waiting state.
3. Attach this worker thread for a single read after the domain exists. Find
   `Assembly-CSharp.dll` → `Campus.Common.User.UserDataManager`.
4. Follow the actual **closed generic parent** and its already initialized
   static `_instance`. Never initialize/create/renew a manager or request a
   login. The open generic definition's static block is not a substitute.
5. Read only these existing backing fields:
   `<_userSupportCardList>k__BackingField`,
   `<_userIdolCardList>k__BackingField`,
   `<_userCharacterList>k__BackingField`,
   `<_userMemoryList>k__BackingField`.
6. Discover field offsets and types through the runtime metadata API. Read
   values with local `memcpy` guarded by Windows structured exception handling
   in the MSVC build; no process-memory API, remote process access rights or
   elevation are requested by that build. A non-MSVC portability fallback uses
   `ReadProcessMemory(GetCurrentProcess(), ...)` only. Header/array offsets and element
   sizes come from runtime exports, not hardcoded Unity class layouts.
7. Read the collection base's `_entries` container. Unwrap only exact
   ``UniRx.ReactiveDictionary`2.inner`` and
   ``System.Collections.ObjectModel.ReadOnlyDictionary`2.m_dictionary`` classes,
   with at most two wrappers, then require ``System.Collections.Generic.Dictionary`2``.
   Recognize the old signed
   `hashCode` layout and the newer unsigned-hash/negative-free-`next` layout.
   Require accepted entries to equal `count-freeCount`. Recheck collection,
   wrapper, dictionary and array pointers, count/free count/version, plus the manager
   instance after reading. Protobuf repeated fields similarly recheck their
   backing array pointer and logical count.
8. Require a nonempty P-idol collection and two consecutive matching complete
   snapshots before publication, avoiding constructor-created empty containers
   during startup. An empty memory collection is valid once ownership is ready.
   Changed data waits for another matching sample; last good data is retained.
   Finish the final metadata consistency check and detach before file publication
   or the polling delay. Do not retain runtime registration during idle periods.

The reader never calls `get_Instance`, collection getters/enumerators, protobuf
serialization, `JsonConvert`, gameplay methods, update/add/delete/clear,
class constructors, garbage collection or memory-snapshot APIs. Runtime metadata
inspection and attaching this worker are still in-process activities; this is
not an external filesystem-only reader. On MSVC, structured exception guards
convert stale native reads into error diagnostics rather than letting access
violations escape the worker's metadata/capture calls.

All lists and strings have bounds. Unknown layouts, missing fields, changing
containers, invalid counts or unrecognized record types fail the collection.
The reader does not reinterpret those failures as zero owned cards. Consistency
checks and repeated sampling reduce races; they do not pause the entire game
or provide a transactional server snapshot.
For unsupported container/record classes or missing fields, the bounded log
records only class, namespace and field metadata names, once per class. It does
not print object values, memory addresses or account/profile data.

## Output contract

`schemaVersion` is 1, `source` is `gakumas-local-collector`, and `capturedAt` is
UTC ISO 8601. `capture.status` is `complete` in published inventory files;
per-collection metadata includes `status`, `expectedCount`, `exportedCount`
and a diagnostic `message`. Latest unsuccessful attempts are in the separate
status file, with `state` equal to `waiting`, `partial` or `error`.

The four arrays contain:

* Support: `supportCardId`, `level`, `levelLimitRank`, `stockQuantity`.
* P-idol: `idolCardId`, `levelLimitRank`, `potentialRank`,
  `primaStellaUpgradedTime`.
* Character: `characterId`, `dearnessPoint`, `trueEndProduceTypes`.
* Memory: `userMemoryId`, `produceId`, `characterId`, `idolCardId`, `planType`,
  `produceCard`, `produceCardPhaseType`, `abilities`, `vocal`, `dance`,
  `visual`, `stamina`, `examBattleProduceCards`, `examBattleProduceItemIds`,
  `isPrimaStella`.

Nested produce cards contain `id`, `upgradeCount`, and `customizes` entries
with `id`/`customizeCount`; abilities contain `id`/`level`. IDs remain strings.
Native 64-bit scalars use decimal strings, following Protobuf JSON's convention
and avoiding JavaScript precision loss. Enums remain numeric. `producerLevel`
is `null`; the app can ask for it without reading unrelated profile fields.

Actual game IDs require master-ID mapping before recommendation. The small
numeric IDs in community data must not be treated as game protocol IDs.

## Offline integration fixture

`il2cpp_api.h` declares the exact 26 required runtime exports and signatures.
A test host must be named `gakumas.exe`, load a fake `GameAssembly.dll` and a
`VuplexWebViewWindows.dll` stub, and provide a closed generic parent with
initialized `_instance`. It can define synthetic metadata fields, dictionaries,
managed strings, arrays and Protobuf-style repeated fields, using field offsets
that match those synthetic structures. This exercises collection and JSON logic
without starting the game or reading an account. Set the INI interval to 2 for
tests. A normal differently named host verifies only version-API forwarding.

Useful cases include both dictionary deletion layouts, nested memory customizes,
UTF-16 IDs, 64-bit timestamps, legitimate empty memories, missing required fields,
changing versions and a login-waiting state that preserves a prior good file.
Passing such fixtures does not establish compatibility with the actual current
game; the local live capture and game-screen checks remain separate validation.

## Optional account HIF panels

In addition to the four required owned collections, the worker reads the existing
`<_userProduceGrowthPanelList>k__BackingField` collection when available. Only
`produceGrowthPanelId`, `level`, and `enable` are exported. The top-level
`growthPanelCapture` describes this optional attempt independently; a complete
`userProduceGrowthPanelList` array is published only after two identical, complete
samples with the same collection consistency checks. Missing, changing or failed
panel reads publish `null` and preserve normal publication of the four required
collections. Missing panels are not converted into confirmed zero/max levels.

These are the current account's enabled panel levels. They are not an old HIF
selection memory's saved active panels or a running final-stage session. Match
the master table by the exact panel ID and current level, apply only enabled
panels, and preserve selection/final split restrictions.
