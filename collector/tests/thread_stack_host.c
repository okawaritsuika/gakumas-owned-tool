#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>

/* Synthetic loader test. A non-game filename prevents the collector worker. */
static DWORD WINAPI small_thread(LPVOID unused) {
    (void)unused;
    return 0;
}

int wmain(int argc, wchar_t **argv) {
    HMODULE module;
    HANDLE thread;
    DWORD exit_code;
    unsigned long reserve_kib;
    if (argc != 3) {
        fwprintf(stderr, L"usage: thread_stack_host.exe absolute-dll-path reserve-kib\n");
        return 2;
    }
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
    reserve_kib = wcstoul(argv[2], NULL, 10);
    if (reserve_kib < 64 || reserve_kib > 1024) return 2;
    module = LoadLibraryW(argv[1]);
    if (!module) {
        fprintf(stderr, "LoadLibrary failed: %lu\n", GetLastError());
        return 3;
    }
    printf("loaded; creating %lu KiB reserved-stack thread\n", reserve_kib);
    fflush(stdout);
    thread = CreateThread(NULL, (SIZE_T)reserve_kib * 1024, small_thread, NULL,
                          STACK_SIZE_PARAM_IS_A_RESERVATION, NULL);
    if (!thread) {
        fprintf(stderr, "CreateThread failed: %lu\n", GetLastError());
        return 4;
    }
    if (WaitForSingleObject(thread, 5000) != WAIT_OBJECT_0 ||
        !GetExitCodeThread(thread, &exit_code) || exit_code != 0) return 5;
    CloseHandle(thread);
    FreeLibrary(module);
    puts("thread attach/detach passed");
    return 0;
}
