/* This isolated test host is deliberately named gakumas.exe. */
#define WIN32_LEAN_AND_MEAN
#define _CRT_SECURE_NO_WARNINGS
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

static HMODULE load_adjacent(const wchar_t *name) {
    wchar_t path[32768];
    wchar_t *slash;
    if (!GetModuleFileNameW(NULL, path, 32768)) return NULL;
    slash = wcsrchr(path, L'\\');
    if (!slash) return NULL;
    slash[1] = 0;
    if (wcslen(path) + wcslen(name) >= 32768) return NULL;
    wcscat(path, name);
    return LoadLibraryW(path);
}

int wmain(int argc, wchar_t **argv) {
    HMODULE game, vuplex, collector;
    void (*set_mode)(int);
    int mode = argc > 1 ? _wtoi(argv[1]) : 0;
    int seconds = argc > 2 ? _wtoi(argv[2]) : 15;
    if (seconds < 3 || seconds > 30) return 11;
    game = load_adjacent(L"GameAssembly.dll");
    if (!game) { fprintf(stderr, "fake GameAssembly load failed: %lu\n", GetLastError()); return 12; }
    set_mode = (void (*)(int))GetProcAddress(game, "fixture_set_mode");
    if (!set_mode) return 13;
    set_mode(mode);
    vuplex = load_adjacent(L"VuplexWebViewWindows.dll");
    if (!vuplex) { fprintf(stderr, "fake Vuplex load failed: %lu\n", GetLastError()); return 14; }
    collector = load_adjacent(L"version.dll");
    if (!collector) { fprintf(stderr, "collector load failed: %lu\n", GetLastError()); return 15; }
    if (argc > 3 && wcsstr(argv[3], L"metrics")) {
        void (*counts)(LONG *, LONG *, LONG *, LONG *, LONG *) =
            (void (*)(LONG *, LONG *, LONG *, LONG *, LONG *))GetProcAddress(game, "fixture_thread_counts");
        LONG (*domain_calls)(void) = (LONG (*)(void))GetProcAddress(game, "fixture_domain_call_count");
        DWORD elapsed;
        if (!counts || !domain_calls) return 33;
        for (elapsed = 0; elapsed < (DWORD)seconds * 1000; elapsed += 250) {
            LONG active, attached, detached, late, unsafe_reads;
            counts(&active, &attached, &detached, &late, &unsafe_reads);
            printf("{\"elapsedMs\":%lu,\"active\":%ld,\"attached\":%ld,\"detached\":%ld,\"domainCalls\":%ld,\"lateAttach\":%ld,\"unattachedMetadataReads\":%ld}\n",
                   elapsed, active, attached, detached, domain_calls(), late, unsafe_reads);
            fflush(stdout);
            Sleep(250);
        }
    } else Sleep((DWORD)seconds * 1000);
    if (argc > 3 && wcsstr(argv[3], L"shutdown")) {
        void (*begin_shutdown)(void) = (void (*)(void))GetProcAddress(game, "fixture_begin_shutdown");
        void (*counts)(LONG *, LONG *, LONG *, LONG *, LONG *) =
            (void (*)(LONG *, LONG *, LONG *, LONG *, LONG *))GetProcAddress(game, "fixture_thread_counts");
        LONG active = 0, attached = 0, detached = 0, late = 0, unsafe_reads = 0;
        LONG before_shutdown;
        DWORD waited = 0;
        if (!begin_shutdown || !counts) return 30;
        begin_shutdown();
        do {
            counts(&active, &attached, &detached, &late, &unsafe_reads);
            if (!active) break;
            Sleep(10); waited += 10;
        } while (waited < 1000);
        before_shutdown = attached;
        if (!active) {
            /* Cross at least one 2-second poll after domain shutdown. */
            Sleep(2500);
            counts(&active, &attached, &detached, &late, &unsafe_reads);
        }
        printf("{\"active\":%ld,\"attached\":%ld,\"detached\":%ld,\"lateAttach\":%ld,\"unattachedMetadataReads\":%ld,\"attachedAtShutdown\":%ld,\"waitedMs\":%lu}\n",
               active, attached, detached, late, unsafe_reads, before_shutdown, waited);
        if (active || attached != detached) return 31;
        if (late || unsafe_reads || attached != before_shutdown || attached < 2) return 32;
    }
    /* Process exit disposes the synthetic runtime; never unload beneath a worker. */
    return 0;
}
