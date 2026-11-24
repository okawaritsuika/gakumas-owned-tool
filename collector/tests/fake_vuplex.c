#define WIN32_LEAN_AND_MEAN
#include <windows.h>

__declspec(dllexport) int fixture_vuplex_ready(void) { return 1; }
BOOL WINAPI DllMain(HINSTANCE module, DWORD reason, LPVOID reserved) {
    (void)module; (void)reason; (void)reserved;
    return TRUE;
}
